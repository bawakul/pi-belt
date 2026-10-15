/**
 * Belt v2 — /next command flows and session-start helpers.
 *
 * Dialog ordering only; no business logic beyond validation.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	readBeltAndStats,
	readNextFile,
	readStats,
	writeBelt,
	writeStats,
	writeNextFile,
	migrateIfNeeded,
	retireSlot,
	addSlot,
	updateSlotField,
	DEFAULT_BELT_FILE,
	DEFAULT_STATS_FILE,
	DEFAULT_NEXT_FILE,
} from "./files.ts";
import type { Slot, Stats, BeltRead } from "./files.ts";
import { getProjectRepos, inferProjectFromCwd, regenThreshold } from "./system.ts";
import type { PickerResult } from "./picker-state.ts";

function slotRowTitle(slot: Slot, picks: number): string {
	return `${slot.id} · ${slot.title.length > 60 ? `${slot.title.slice(0, 59)}…` : slot.title} · ×${picks}`;
}

function parseIdFromRow(selected: string): string | undefined {
	const m = selected.match(/^(b\d+)\s+·/);
	return m?.[1];
}

async function selectProject(
	ctx: ExtensionContext,
	allProjects: string[],
): Promise<string | null | undefined> {
	const cwdProject = inferProjectFromCwd(ctx.cwd, allProjects);
	const pickerItems: string[] = [];
	if (cwdProject) pickerItems.push(`${cwdProject}  (current dir)`);
	for (const proj of allProjects) {
		if (proj !== cwdProject) pickerItems.push(proj);
	}
	pickerItems.push("No project");

	const selected = await ctx.ui.select("Select project", pickerItems);
	if (selected === undefined || selected === null) return undefined;

	if (selected === "No project") return null;
	const projName = selected.replace(/\s*\(current dir\)\s*$/, "").trim();
	return allProjects.includes(projName) ? projName : null;
}

function isSyntaxDamage(reason?: string): boolean {
	return !!reason && (reason.includes("unknown field") || reason.includes("malformed"));
}

export async function cmdList(ctx: ExtensionContext): Promise<PickerResult> {
	const read = readBeltAndStats(DEFAULT_BELT_FILE, DEFAULT_STATS_FILE);
	if (!read.valid) {
		ctx.ui.notify(`belt invalid: ${read.reason}`, "warning");
		return { kind: "skip" };
	}

	// Bare /next uses the same pick-mode overlay as session start.
	const { showBeltOverlay } = await import("./ui-picker.ts");
	const next = readNextFile(DEFAULT_NEXT_FILE);
	return showBeltOverlay(ctx, { mode: "pick", slots: read.slots, stats: read.stats, next });
}

export async function cmdAdd(ctx: ExtensionContext, title: string): Promise<void> {
	const trimmedTitle = title.trim();
	if (!trimmedTitle) {
		ctx.ui.notify("usage: /next <the one thing you'll do next>", "warning");
		return;
	}

	migrateIfNeeded();
	const read = readBeltAndStats(DEFAULT_BELT_FILE, DEFAULT_STATS_FILE);
	if (!read.valid) {
		ctx.ui.notify(`belt invalid: ${read.reason}`, "warning");
		return;
	}
	let { slots, stats } = read;

	// Pitch first — the sell is the heart of the entry; ask while it matters,
	// before the housekeeping (project) and the friction (swap-if-full).
	const pitch = await ctx.ui.input("Pitch this task", "required — no pitch, no belt");
	if (!pitch?.trim()) {
		ctx.ui.notify("no pitch, no belt", "warning");
		return;
	}

	const allProjects = getProjectRepos();
	const project = await selectProject(ctx, allProjects);
	if (project === undefined) return;

	if (slots.length >= 3) {
		const victimOptions = slots.map((slot) => slotRowTitle(slot, stats.slots.get(slot.id)?.picks ?? 0));
		const victimSelected = await ctx.ui.select("Belt is full — which slot comes off?", victimOptions);
		if (victimSelected === undefined || victimSelected === null) return;

		const victimId = parseIdFromRow(victimSelected);
		if (!victimId) return;

		const victimReason = await ctx.ui.input("Why is this slot coming off?", "required");
		if (!victimReason?.trim()) {
			ctx.ui.notify("removal cancelled — reason required", "warning");
			return;
		}

		const retired = retireSlot(stats, slots, victimId, victimReason.trim());
		slots = retired.slots;
		stats = retired.stats;
	}

	const added = addSlot(stats, slots, {
		title: trimmedTitle,
		pitch: pitch.trim(),
		project: project || undefined,
	});
	slots = added.slots;
	stats = added.stats;

	writeBelt(slots, DEFAULT_BELT_FILE);
	writeStats(stats, DEFAULT_STATS_FILE);
	regenThreshold();
	ctx.ui.notify(`✓ ${trimmedTitle} · ${added.slot.id}`, "info");
}

export async function cmdDone(ctx: ExtensionContext): Promise<void> {
	migrateIfNeeded();
	const read = readBeltAndStats(DEFAULT_BELT_FILE, DEFAULT_STATS_FILE);
	if (!read.valid) {
		ctx.ui.notify(`belt invalid: ${read.reason}`, "warning");
		return;
	}
	if (read.slots.length === 0) {
		ctx.ui.notify("belt is empty", "warning");
		return;
	}
	let { slots, stats } = read;

	const options = slots.map((slot) => slotRowTitle(slot, stats.slots.get(slot.id)?.picks ?? 0));
	const selected = await ctx.ui.select("Retire which slot?", options);
	if (selected === undefined || selected === null) return;

	const id = parseIdFromRow(selected);
	if (!id) return;

	const reasonText = await ctx.ui.input("Reason (optional)");
	const retired = retireSlot(stats, slots, id, reasonText?.trim() ?? "");
	slots = retired.slots;
	stats = retired.stats;

	writeBelt(slots, DEFAULT_BELT_FILE);
	writeStats(stats, DEFAULT_STATS_FILE);
	regenThreshold();
	ctx.ui.notify(`retired ${id}`, "info");
}

export async function cmdEdit(ctx: ExtensionContext): Promise<void> {
	migrateIfNeeded();
	const read = readBeltAndStats(DEFAULT_BELT_FILE, DEFAULT_STATS_FILE);
	if (!read.valid) {
		ctx.ui.notify(`belt invalid: ${read.reason}`, "warning");
		return;
	}
	if (read.slots.length === 0) {
		ctx.ui.notify("belt is empty", "warning");
		return;
	}
	const slots = read.slots;

	const slotOptions = slots.map((slot) => slotRowTitle(slot, read.stats.slots.get(slot.id)?.picks ?? 0));
	const slotSelected = await ctx.ui.select("Edit which slot?", slotOptions);
	if (slotSelected === undefined || slotSelected === null) return;

	const id = parseIdFromRow(slotSelected);
	if (!id) return;

	const fieldOptions = ["title", "pitch", "project", "context"];
	const fieldSelected = await ctx.ui.select("Which field?", fieldOptions);
	if (fieldSelected === undefined || fieldSelected === null) return;
	const field = fieldSelected as "title" | "pitch" | "project" | "context";

	const slot = slots.find((s) => s.id === id);
	const currentValue = slot?.[field] ?? "";
	const newValue = await ctx.ui.input(`New ${field}`, currentValue);
	if (newValue === undefined || newValue === null) return;

	if ((field === "title" || field === "pitch") && !newValue.trim()) {
		ctx.ui.notify(`${field} cannot be empty`, "warning");
		return;
	}

	const updated = updateSlotField(slots, id, field, newValue);
	writeBelt(updated, DEFAULT_BELT_FILE);
	writeStats(read.stats, DEFAULT_STATS_FILE);
	regenThreshold();
	ctx.ui.notify(`updated ${id} · ${field}`, "info");
}

export async function promptFirstSlot(ctx: ExtensionContext): Promise<BeltRead | undefined> {
	const title = await ctx.ui.input("belt's empty — first slot?");
	if (!title?.trim()) return undefined;

	const allProjects = getProjectRepos();
	const project = await selectProject(ctx, allProjects);
	if (project === undefined) return undefined;

	const pitch = await ctx.ui.input("Pitch this task", "required — no pitch, no belt");
	if (!pitch?.trim()) {
		ctx.ui.notify("no pitch, no belt", "warning");
		return undefined;
	}

	const stats = readStats(DEFAULT_STATS_FILE);
	const added = addSlot(stats, [], {
		title: title.trim(),
		pitch: pitch.trim(),
		project: project || undefined,
	});
	writeBelt(added.slots, DEFAULT_BELT_FILE);
	writeStats(added.stats, DEFAULT_STATS_FILE);
	regenThreshold();
	return { slots: added.slots, stats: added.stats, valid: true };
}

export async function repairBelt(
	ctx: ExtensionContext,
	read: BeltRead,
): Promise<BeltRead | undefined> {
	if (isSyntaxDamage(read.reason)) {
		ctx.ui.notify(`belt syntax error: ${read.reason} — edit ${DEFAULT_BELT_FILE}`, "error");
		return undefined;
	}

	let { slots, stats } = read;

	while (slots.length > 3) {
		const options = slots.map((slot) => slotRowTitle(slot, stats.slots.get(slot.id)?.picks ?? 0));
		const selected = await ctx.ui.select("Belt over capacity — remove one", options);
		if (selected === undefined || selected === null) return undefined;
		const id = parseIdFromRow(selected);
		if (!id) continue;
		const reason = await ctx.ui.input("Why remove this slot?", "required");
		if (!reason?.trim()) {
			ctx.ui.notify("repair cancelled — reason required", "warning");
			return undefined;
		}
		const retired = retireSlot(stats, slots, id, reason.trim());
		slots = retired.slots;
		stats = retired.stats;
	}

	for (const slot of slots) {
		if (!slot.pitch.trim() || slot.pitch === "(pitch me — /next edit)") {
			const pitch = await ctx.ui.input(`Pitch for "${slot.title}"`, "required");
			if (!pitch?.trim()) {
				ctx.ui.notify("repair cancelled — pitch required", "warning");
				return undefined;
			}
			slots = updateSlotField(slots, slot.id, "pitch", pitch.trim());
		}
	}

	writeBelt(slots, DEFAULT_BELT_FILE);
	writeStats(stats, DEFAULT_STATS_FILE);
	regenThreshold();
	return { slots, stats, valid: true };
}
