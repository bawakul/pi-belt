/**
 * Belt v2 — pure data contract.
 *
 * Imports only node:* builtins. Parses/serializes belt.md, belt-stats.md,
 * next.md; runs migration; performs all state operations and formatting.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ===== Types =====

export interface Slot {
	id: string;
	title: string;
	pitch: string;
	project?: string;
	context?: string;
}

export interface SlotStats {
	picks: number;
	added: string; // YYYY-MM-DD
	last?: string; // YYYY-MM-DD
}

export interface RetiredEntry {
	id: string;
	title: string;
	when: string; // YYYY-MM-DD
	reason: string;
}

export interface Stats {
	nextId: number;
	slots: Map<string, SlotStats>;
	escapes: { total: number; streak: number; longest: number };
	retired: RetiredEntry[];
}

export interface BeltRead {
	slots: Slot[];
	stats: Stats;
	valid: boolean;
	reason?: string;
}

export type NextTask = { task: string; project: string | null };

// ===== Paths =====

const MEMORY_DIR = join(homedir(), ".pi", "agent", "memory");
export const DEFAULT_BELT_FILE = join(MEMORY_DIR, "belt.md");
export const DEFAULT_STATS_FILE = join(MEMORY_DIR, "belt-stats.md");
export const DEFAULT_NEXT_FILE = join(MEMORY_DIR, "next.md");

// ===== Dates =====

export function todayLocal(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function parseLocalDate(s: string): Date {
	const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
	return new Date(y as number, (m as number) - 1, d as number);
}

export function daysBetween(a: string, b: string): number {
	const ms = parseLocalDate(b).getTime() - parseLocalDate(a).getTime();
	return Math.max(0, Math.floor(ms / 86_400_000));
}

// ===== Block parsing (shared) =====

export function parseBlocks(content: string): Array<Record<string, string>> {
	const blocks: Array<Record<string, string>> = [];
	let current: Record<string, string> | null = null;

	for (const raw of content.split("\n")) {
		const line = raw.replace(/\r$/, "");
		if (line.trim() === "") {
			if (current) {
				blocks.push(current);
				current = null;
			}
			continue;
		}

		const colon = line.indexOf(":");
		if (colon === -1) {
			if (!current) current = {};
			current["__malformed__"] = line;
			continue;
		}

		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		if (!current) current = {};
		current[key] = value;
	}
	if (current) blocks.push(current);

	return blocks;
}

// ===== Belt file =====

const ALLOWED_FIELDS = new Set(["id", "title", "pitch", "project", "context"]);
const REQUIRED_FIELDS = new Set(["id", "title", "pitch"]);

function slotFromBlock(block: Record<string, string>): Slot {
	return {
		id: block.id,
		title: block.title,
		pitch: block.pitch,
		...(block.project ? { project: block.project } : {}),
		...(block.context ? { context: block.context } : {}),
	};
}

function validateBlock(block: Record<string, string>): { valid: boolean; reason?: string } {
	if ("__malformed__" in block) {
		return { valid: false, reason: "malformed belt block" };
	}
	for (const key of Object.keys(block)) {
		if (!ALLOWED_FIELDS.has(key)) {
			return { valid: false, reason: `unknown field '${key}' in belt block` };
		}
	}
	for (const key of REQUIRED_FIELDS) {
		if (!(key in block)) {
			return { valid: false, reason: `missing required field '${key}' in belt block` };
		}
	}
	return { valid: true };
}

function validateSlots(slots: Slot[]): { valid: boolean; reason?: string } {
	if (slots.length > 3) {
		return { valid: false, reason: `too many slots (${slots.length})` };
	}
	for (const slot of slots) {
		if (!slot.title.trim()) {
			return { valid: false, reason: `slot ${slot.id} has empty title` };
		}
		if (!slot.pitch.trim()) {
			return { valid: false, reason: `slot ${slot.id} is missing a pitch` };
		}
	}
	return { valid: true };
}

export function parseBelt(content: string): { slots: Slot[]; invalid?: string } {
	const blocks = parseBlocks(content);
	const slots: Slot[] = [];
	for (const block of blocks) {
		const { valid, reason } = validateBlock(block);
		if (!valid) return { slots: [], invalid: reason };
		slots.push(slotFromBlock(block));
	}
	const { valid, reason } = validateSlots(slots);
	if (!valid) return { slots, invalid: reason };
	return { slots };
}

export function serializeBelt(slots: Slot[]): string {
	const lines: string[] = [];
	for (const slot of slots) {
		lines.push(`id: ${slot.id}`);
		lines.push(`title: ${slot.title}`);
		lines.push(`pitch: ${slot.pitch}`);
		if (slot.project) lines.push(`project: ${slot.project}`);
		if (slot.context) lines.push(`context: ${slot.context}`);
		lines.push("");
	}
	return lines.join("\n");
}

export function readBelt(path: string = DEFAULT_BELT_FILE): Slot[] {
	if (!existsSync(path)) return [];
	const result = parseBelt(readFileSync(path, "utf-8"));
	return result.slots;
}

export function writeBelt(slots: Slot[], path: string = DEFAULT_BELT_FILE): void {
	writeFileSync(path, serializeBelt(slots), "utf-8");
}

// ===== Stats file =====

function parseSlotStatsLine(line: string): { id: string; stats: SlotStats } | null {
	const m = line.match(
		/^slot (b\d+): picks (\d+) · added (\d{4}-\d{2}-\d{2})(?: · last (\d{4}-\d{2}-\d{2}))?$/,
	);
	if (!m) return null;
	return {
		id: m[1] as string,
		stats: {
			picks: parseInt(m[2] as string, 10),
			added: m[3] as string,
			last: m[4] || undefined,
		},
	};
}

function parseEscapesLine(line: string): Stats["escapes"] | null {
	const m = line.match(/^escapes: total (\d+) · streak (\d+) · longest (\d+)$/);
	if (!m) return null;
	return {
		total: parseInt(m[1] as string, 10),
		streak: parseInt(m[2] as string, 10),
		longest: parseInt(m[3] as string, 10),
	};
}

function retiredFromBlock(block: Record<string, string>): RetiredEntry | null {
	if (!block.id || !block.title || !block.when) return null;
	return {
		id: block.id,
		title: block.title,
		when: block.when,
		reason: block.reason || "",
	};
}

export function parseStats(content: string): Stats {
	const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
	const firstBlank = lines.findIndex((l) => l.trim() === "");
	const headerLines = firstBlank === -1 ? lines : lines.slice(0, firstBlank);
	const bodyLines = firstBlank === -1 ? [] : lines.slice(firstBlank + 1);

	let nextId = 1;
	const slots = new Map<string, SlotStats>();
	let escapes: Stats["escapes"] = { total: 0, streak: 0, longest: 0 };

	for (const line of headerLines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (trimmed.startsWith("next-id:")) {
			const val = parseInt(trimmed.slice("next-id:".length).trim(), 10);
			if (!Number.isNaN(val)) nextId = val;
			continue;
		}

		const slotStat = parseSlotStatsLine(trimmed);
		if (slotStat) {
			slots.set(slotStat.id, slotStat.stats);
			continue;
		}

		const esc = parseEscapesLine(trimmed);
		if (esc) {
			escapes = esc;
		}
		// Unparseable header lines are silently skipped.
	}

	const retiredBlocks = parseBlocks(bodyLines.join("\n"));
	const retired = retiredBlocks.map(retiredFromBlock).filter((r): r is RetiredEntry => r !== null);

	return { nextId, slots, escapes, retired };
}

export function serializeStats(stats: Stats): string {
	const lines: string[] = [];
	lines.push(`next-id: ${stats.nextId}`);

	const slotIds = Array.from(stats.slots.keys()).sort((a, b) => {
		const na = parseInt(a.slice(1), 10);
		const nb = parseInt(b.slice(1), 10);
		return na - nb;
	});
	for (const id of slotIds) {
		const s = stats.slots.get(id)!;
		const lastPart = s.last ? ` · last ${s.last}` : "";
		lines.push(`slot ${id}: picks ${s.picks} · added ${s.added}${lastPart}`);
	}

	lines.push(
		`escapes: total ${stats.escapes.total} · streak ${stats.escapes.streak} · longest ${stats.escapes.longest}`,
	);
	lines.push("");

	for (const r of stats.retired) {
		lines.push(`id: ${r.id}`);
		lines.push(`title: ${r.title}`);
		lines.push(`when: ${r.when}`);
		lines.push(`reason: ${r.reason}`);
		lines.push("");
	}

	return lines.join("\n");
}

export function readStats(path: string = DEFAULT_STATS_FILE): Stats {
	if (!existsSync(path)) {
		return {
			nextId: 1,
			slots: new Map(),
			escapes: { total: 0, streak: 0, longest: 0 },
			retired: [],
		};
	}
	return parseStats(readFileSync(path, "utf-8"));
}

export function writeStats(stats: Stats, path: string = DEFAULT_STATS_FILE): void {
	writeFileSync(path, serializeStats(stats), "utf-8");
}

export function reconcileStats(stats: Stats, slots: Slot[], today: string = todayLocal()): void {
	for (const slot of slots) {
		if (!stats.slots.has(slot.id)) {
			stats.slots.set(slot.id, { picks: 0, added: today });
		}
	}
}

export function readBeltAndStats(
	beltPath: string = DEFAULT_BELT_FILE,
	statsPath: string = DEFAULT_STATS_FILE,
	today: string = todayLocal(),
): BeltRead {
	const rawBelt = existsSync(beltPath) ? readFileSync(beltPath, "utf-8") : "";
	const belt = parseBelt(rawBelt);
	const stats = readStats(statsPath);
	if (belt.invalid) {
		return { slots: belt.slots, stats, valid: false, reason: belt.invalid };
	}
	reconcileStats(stats, belt.slots, today);
	return { slots: belt.slots, stats, valid: true };
}

// ===== next.md =====

export function readNextFile(path: string = DEFAULT_NEXT_FILE): NextTask | null {
	if (!existsSync(path)) return null;
	const content = readFileSync(path, "utf-8");
	if (!content.trim()) return null;

	let task = "";
	let project: string | null = null;

	for (const line of content.split("\n")) {
		if (line.startsWith("next: ")) {
			task = line.slice(6).trim();
		} else if (line.startsWith("project: ")) {
			const raw = line.slice(9).trim();
			project = raw && raw !== "—" ? raw : null;
		}
	}

	if (!task) return null;
	return { task, project };
}

export function writeNextFile(
	task: string,
	project: string | null,
	path: string = DEFAULT_NEXT_FILE,
): void {
	const projLine = project ? `project: ${project}\n` : "";
	writeFileSync(path, `next: ${task}\n${projLine}`, "utf-8");
}

// ===== Migration =====

export function migrateIfNeeded(
	beltPath: string = DEFAULT_BELT_FILE,
	statsPath: string = DEFAULT_STATS_FILE,
	nextPath: string = DEFAULT_NEXT_FILE,
	today: string = todayLocal(),
): { migrated: boolean; slots: Slot[]; stats: Stats } {
	if (existsSync(beltPath)) {
		const { slots, stats } = readBeltAndStats(beltPath, statsPath, today);
		return { migrated: false, slots, stats };
	}

	const next = readNextFile(nextPath);
	if (!next) {
		return {
			migrated: false,
			slots: [],
			stats: {
				nextId: 1,
				slots: new Map(),
				escapes: { total: 0, streak: 0, longest: 0 },
				retired: [],
			},
		};
	}

	const slots: Slot[] = [
		{
			id: "b1",
			title: next.task,
			pitch: "(pitch me — /next edit)",
			project: next.project || undefined,
		},
	];
	const stats: Stats = {
		nextId: 2,
		slots: new Map(),
		escapes: { total: 0, streak: 0, longest: 0 },
		retired: [],
	};
	writeBelt(slots, beltPath);
	writeStats(stats, statsPath);
	return { migrated: true, slots, stats };
}

// ===== Operations =====

export function ensureStatsForSlot(
	stats: Stats,
	slot: Slot,
	today: string = todayLocal(),
): void {
	if (!stats.slots.has(slot.id)) {
		stats.slots.set(slot.id, { picks: 0, added: today });
	}
}

export function pickSlot(stats: Stats, slot: Slot, today: string = todayLocal()): void {
	ensureStatsForSlot(stats, slot, today);
	const s = stats.slots.get(slot.id)!;
	s.picks += 1;
	s.last = today;
	stats.escapes.streak = 0;
}

export function recordEscape(stats: Stats): void {
	stats.escapes.total += 1;
	stats.escapes.streak += 1;
	if (stats.escapes.streak > stats.escapes.longest) {
		stats.escapes.longest = stats.escapes.streak;
	}
}

export function retireSlot(
	stats: Stats,
	slots: Slot[],
	id: string,
	reason: string,
	today: string = todayLocal(),
): { slots: Slot[]; stats: Stats } {
	const slot = slots.find((s) => s.id === id);
	if (!slot) return { slots, stats };

	const newSlots = slots.filter((s) => s.id !== id);
	stats.retired.unshift({
		id: slot.id,
		title: slot.title,
		when: today,
		reason,
	});
	if (stats.retired.length > 10) {
		stats.retired = stats.retired.slice(0, 10);
	}
	return { slots: newSlots, stats };
}

export interface AddSlotInput {
	title: string;
	pitch: string;
	project?: string;
	context?: string;
}

export function addSlot(
	stats: Stats,
	slots: Slot[],
	input: AddSlotInput,
	today: string = todayLocal(),
): { slots: Slot[]; stats: Stats; slot: Slot } {
	const id = `b${stats.nextId}`;
	stats.nextId += 1;
	const slot: Slot = {
		id,
		title: input.title,
		pitch: input.pitch,
		...(input.project ? { project: input.project } : {}),
		...(input.context ? { context: input.context } : {}),
	};
	slots.push(slot);
	ensureStatsForSlot(stats, slot, today);
	return { slots, stats, slot };
}

export function updateSlotField(
	slots: Slot[],
	id: string,
	field: "title" | "pitch" | "project" | "context",
	value: string,
): Slot[] {
	return slots.map((s) => {
		if (s.id !== id) return s;
		const updated = { ...s };
		if (field === "project" || field === "context") {
			const trimmed = value.trim();
			if (trimmed) {
				updated[field] = trimmed;
			} else {
				delete updated[field];
			}
		} else {
			updated[field] = value;
		}
		return updated;
	});
}

// ===== Formatting =====

export function truncatePlain(text: string, max: number): string {
	if (max <= 0) return "";
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function slotMeta(
	slot: Slot,
	stats: Stats,
	today: string = todayLocal(),
): string {
	const s = stats.slots.get(slot.id);
	const picks = s?.picks ?? 0;
	const added = s?.added ?? today;
	const onBelt = daysBetween(added, today);
	let meta = `×${picks} picks · on belt ${onBelt}d`;
	if (s?.last) {
		const lastAgo = daysBetween(s.last, today);
		meta += ` · last picked ${lastAgo}d ago`;
	}
	return meta;
}

export function formatBeltSummary(
	slots: Slot[],
	next: NextTask | null,
	stats: Stats,
): string {
	const lines: string[] = [`Belt (${slots.length}/3):`];
	if (slots.length === 0) {
		lines.push("(empty)");
	}
	for (const s of slots) {
		const isActive = !!next && next.task === s.title;
		const picks = stats.slots.get(s.id)?.picks ?? 0;
		const proj = s.project ? ` · ${s.project}` : "";
		lines.push(`${isActive ? "→" : " "} ${s.id} · ${truncatePlain(s.title, 60)}${proj} · ×${picks}`);
		lines.push(`   ${truncatePlain(s.pitch, 100)}`);
	}
	if (next && !slots.some((s) => s.title === next.task)) {
		const proj = next.project ? ` (${next.project})` : "";
		lines.push(`Active (off-belt): ${truncatePlain(next.task, 80)}${proj}`);
	}
	return lines.join("\n");
}

export function formatPickInjection(slot: Slot): string {
	const projectPart = slot.project ? ` (${slot.project})` : "";
	const contextPart = slot.context ? ` Context: ${slot.context}.` : "";
	return `Working on ${slot.title}${projectPart}. Pitch: ${slot.pitch}.${contextPart}`;
}

export function formatEscapeNotify(stats: Stats): string {
	return `escape ×${stats.escapes.total} — streak ${stats.escapes.streak}`;
}
