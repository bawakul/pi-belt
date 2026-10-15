/**
 * Belt v2 data contract tests.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	readBelt,
	writeBelt,
	readStats,
	writeStats,
	readBeltAndStats,
	readNextFile,
	writeNextFile,
	migrateIfNeeded,
	pickSlot,
	recordEscape,
	retireSlot,
	addSlot,
	updateSlotField,
	formatBeltSummary,
	formatPickInjection,
	formatEscapeNotify,
	slotMeta,
	reconcileStats,
	parseStats,
	parseBelt,
	truncatePlain,
	todayLocal,
	daysBetween,
	DEFAULT_BELT_FILE,
	DEFAULT_STATS_FILE,
	DEFAULT_NEXT_FILE,
} from "./files.ts";
import type { Slot, Stats } from "./files.ts";

const FIXTURE_BELT = `id: b1
title: finish trmnl-conscience: merge_variables + push path
pitch: threshold page is half-built and one focused evening finishes it — swap the hardcoded markup for merge_variables, add the 5 missing fields, wire the --trmnl push. e-ink glory, zero drama.
project: trmnl-conscience

id: b2
title: set up research-vault: Surfing + uBlock Lite in Obsidian
pitch: the whole plan is already researched and written — pick the vault + project, install Surfing with uBlock Lite, and Obsidian becomes the distraction-free research room you already chose. One sitting, everything else is ready.

id: b3
title: fix the broken /handoff extension
pitch: it silently failed once and cost a whole session of reconstructing context by hand. A contained 30-minute investigation — extension, settings, dry run — makes session continuity trustworthy again. Small, satisfying, done in one sitting.
`;

const FIXTURE_STATS = `next-id: 4
slot b1: picks 1 · added 2026-10-14 · last 2026-10-14
slot b2: picks 0 · added 2026-10-14
slot b3: picks 0 · added 2026-10-14
escapes: total 0 · streak 0 · longest 0
`;

const FIXTURE_STATS_CORRUPTED = `next-id: 4
slot b1: picks 1 · added 2026-10-14 · last 2026-10-14
: picks 0 · added 2026-10-14
slot b3: picks 0 · added 2026-10-14
escapes: total 0 · streak 0 · longest 0
`;

const FIXTURE_NEXT = `next: something's still wrong
project: Bawa's Lab
`;

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "belt-v2-test-"));
}

describe("live-data fixtures", () => {
	it("parses today's real belt.md (3 slots, optional lines present/absent)", () => {
		const { slots, invalid } = parseBelt(FIXTURE_BELT);
		assert.strictEqual(invalid, undefined);
		assert.strictEqual(slots.length, 3);
		assert.strictEqual(slots[0]?.id, "b1");
		assert.strictEqual(slots[0]?.project, "trmnl-conscience");
		assert.strictEqual(slots[1]?.project, undefined);
		assert.strictEqual(slots[2]?.project, undefined);
		assert.ok(slots[2]?.title.includes("/handoff"));
	});

	it("parses today's real belt-stats.md", () => {
		const stats = parseStats(FIXTURE_STATS);
		assert.strictEqual(stats.nextId, 4);
		assert.strictEqual(stats.slots.get("b1")?.picks, 1);
		assert.strictEqual(stats.slots.get("b1")?.last, "2026-10-14");
		assert.strictEqual(stats.slots.get("b2")?.picks, 0);
		assert.strictEqual(stats.slots.get("b3")?.picks, 0);
	});

	it("tolerates corrupted stats line — skips it, keeps b1/b3, does not crash", () => {
		const stats = parseStats(FIXTURE_STATS_CORRUPTED);
		assert.strictEqual(stats.nextId, 4);
		assert.strictEqual(stats.slots.has("b2"), false);
		assert.strictEqual(stats.slots.get("b1")?.picks, 1);
		assert.strictEqual(stats.slots.get("b3")?.picks, 0);
	});

	it("round-trips next.md including project: — → null", () => {
		const parsed = readNextFileFromString(FIXTURE_NEXT);
		assert.deepStrictEqual(parsed, { task: "something's still wrong", project: "Bawa's Lab" });
	});
});

function readNextFileFromString(content: string) {
	const dir = tmpDir();
	const path = join(dir, "next.md");
	writeFileSync(path, content, "utf-8");
	return readNextFile(path);
}

describe("belt.md read/write", () => {
	it("round-trips slots", () => {
		const dir = tmpDir();
		const path = join(dir, "belt.md");
		const slots: Slot[] = [
			{ id: "b1", title: "fix dashboard", pitch: "one evening finishes it", project: "threshold" },
			{ id: "b2", title: "write essay", pitch: "first draft", context: "handoff.md" },
		];
		writeBelt(slots, path);
		const parsed = readBelt(path);
		assert.deepStrictEqual(parsed, slots);
	});

	it("returns empty array for missing file", () => {
		assert.deepStrictEqual(readBelt(join(tmpDir(), "missing.md")), []);
	});
});

describe("belt validation", () => {
	it("accepts up to three slots", () => {
		const dir = tmpDir();
		const path = join(dir, "belt.md");
		writeBelt(
			[
				{ id: "b1", title: "a", pitch: "p" },
				{ id: "b2", title: "b", pitch: "p" },
				{ id: "b3", title: "c", pitch: "p" },
			],
			path,
		);
		const result = readBeltAndStats(path, join(dir, "stats.md"));
		assert.strictEqual(result.valid, true);
	});

	it("rejects four slots", () => {
		const dir = tmpDir();
		const path = join(dir, "belt.md");
		writeBelt(
			[
				{ id: "b1", title: "a", pitch: "p" },
				{ id: "b2", title: "b", pitch: "p" },
				{ id: "b3", title: "c", pitch: "p" },
				{ id: "b4", title: "d", pitch: "p" },
			],
			path,
		);
		const result = readBeltAndStats(path, join(dir, "stats.md"));
		assert.strictEqual(result.valid, false);
		assert.ok(result.reason?.includes("too many slots"));
	});

	it("rejects empty title", () => {
		const dir = tmpDir();
		const path = join(dir, "belt.md");
		writeFileSync(path, "id: b1\ntitle: \npitch: ok\n", "utf-8");
		const result = readBeltAndStats(path, join(dir, "stats.md"));
		assert.strictEqual(result.valid, false);
		assert.ok(result.reason?.includes("empty title"));
	});

	it("rejects missing pitch", () => {
		const dir = tmpDir();
		const path = join(dir, "belt.md");
		writeFileSync(path, "id: b1\ntitle: ok\n", "utf-8");
		const result = readBeltAndStats(path, join(dir, "stats.md"));
		assert.strictEqual(result.valid, false);
	});

	it("rejects unknown field", () => {
		const dir = tmpDir();
		const path = join(dir, "belt.md");
		writeFileSync(path, "id: b1\ntitle: ok\npitch: ok\nfoo: bar\n", "utf-8");
		const result = readBeltAndStats(path, join(dir, "stats.md"));
		assert.strictEqual(result.valid, false);
		assert.ok(result.reason?.includes("unknown field 'foo'"));
	});

	it("rejects malformed line", () => {
		const dir = tmpDir();
		const path = join(dir, "belt.md");
		writeFileSync(path, "id: b1\ntitle: ok\npitch: ok\nnot a field\n", "utf-8");
		const result = readBeltAndStats(path, join(dir, "stats.md"));
		assert.strictEqual(result.valid, false);
		assert.ok(result.reason?.includes("malformed"));
	});
});

describe("stats read/write", () => {
	it("round-trips stats", () => {
		const dir = tmpDir();
		const path = join(dir, "stats.md");
		const stats: Stats = {
			nextId: 5,
			slots: new Map([
				["b1", { picks: 3, added: "2026-09-01", last: "2026-10-01" }],
				["b2", { picks: 0, added: "2026-09-05" }],
			]),
			escapes: { total: 7, streak: 3, longest: 5 },
			retired: [{ id: "b0", title: "old", when: "2026-08-01", reason: "done" }],
		};
		writeStats(stats, path);
		const parsed = readStats(path);
		assert.strictEqual(parsed.nextId, 5);
		assert.deepStrictEqual(parsed.escapes, { total: 7, streak: 3, longest: 5 });
		assert.strictEqual(parsed.slots.get("b1")?.picks, 3);
		assert.strictEqual(parsed.slots.get("b1")?.last, "2026-10-01");
		assert.strictEqual(parsed.retired[0]?.reason, "done");
	});

	it("returns defaults for missing file", () => {
		const parsed = readStats(join(tmpDir(), "missing.md"));
		assert.strictEqual(parsed.nextId, 1);
		assert.strictEqual(parsed.escapes.total, 0);
		assert.strictEqual(parsed.retired.length, 0);
	});
});

describe("migration", () => {
	it("migrates existing next.md and bumps next-id", () => {
		const dir = tmpDir();
		const beltPath = join(dir, "belt.md");
		const statsPath = join(dir, "stats.md");
		const nextPath = join(dir, "next.md");
		writeFileSync(nextPath, "next: swap trmnl markup\nproject: trmnl-conscience\n", "utf-8");

		const { migrated, slots, stats } = migrateIfNeeded(beltPath, statsPath, nextPath, "2026-10-15");

		assert.strictEqual(migrated, true);
		assert.strictEqual(slots.length, 1);
		assert.strictEqual(slots[0]?.id, "b1");
		assert.strictEqual(slots[0]?.pitch, "(pitch me — /next edit)");
		assert.strictEqual(slots[0]?.project, "trmnl-conscience");
		assert.strictEqual(stats.nextId, 2);
		assert.ok(existsSync(beltPath));
		assert.ok(existsSync(statsPath));
	});

	it("does nothing when belt.md already exists", () => {
		const dir = tmpDir();
		const beltPath = join(dir, "belt.md");
		const statsPath = join(dir, "stats.md");
		const nextPath = join(dir, "next.md");
		writeBelt([{ id: "b2", title: "existing", pitch: "p" }], beltPath);
		writeStats(
			{ nextId: 3, slots: new Map(), escapes: { total: 0, streak: 0, longest: 0 }, retired: [] },
			statsPath,
		);
		writeFileSync(nextPath, "next: old\n", "utf-8");

		const { migrated, slots } = migrateIfNeeded(beltPath, statsPath, nextPath, "2026-10-15");
		assert.strictEqual(migrated, false);
		assert.strictEqual(slots[0]?.id, "b2");
	});

	it("does not migrate when next.md missing", () => {
		const dir = tmpDir();
		const beltPath = join(dir, "belt.md");
		const statsPath = join(dir, "stats.md");
		const { migrated, stats } = migrateIfNeeded(beltPath, statsPath, join(dir, "missing.md"), "2026-10-15");
		assert.strictEqual(migrated, false);
		assert.strictEqual(stats.nextId, 1);
		assert.strictEqual(existsSync(beltPath), false);
		assert.strictEqual(existsSync(statsPath), false);
	});
});

describe("operations", () => {
	it("pick increments picks, sets last, resets streak", () => {
		const stats: Stats = {
			nextId: 2,
			slots: new Map([["b1", { picks: 2, added: "2026-09-01", last: "2026-09-10" }]]),
			escapes: { total: 5, streak: 3, longest: 4 },
			retired: [],
		};
		pickSlot(stats, { id: "b1", title: "t", pitch: "p" }, "2026-10-15");
		assert.strictEqual(stats.slots.get("b1")?.picks, 3);
		assert.strictEqual(stats.slots.get("b1")?.last, "2026-10-15");
		assert.strictEqual(stats.escapes.streak, 0);
	});

	it("pick auto-creates missing stats entry", () => {
		const stats: Stats = {
			nextId: 2,
			slots: new Map(),
			escapes: { total: 0, streak: 0, longest: 0 },
			retired: [],
		};
		pickSlot(stats, { id: "b1", title: "t", pitch: "p" }, "2026-10-15");
		assert.strictEqual(stats.slots.get("b1")?.picks, 1);
		assert.strictEqual(stats.slots.get("b1")?.added, "2026-10-15");
	});

	it("escape increments total and streak, updates longest", () => {
		const stats: Stats = {
			nextId: 1,
			slots: new Map(),
			escapes: { total: 4, streak: 2, longest: 2 },
			retired: [],
		};
		recordEscape(stats);
		assert.strictEqual(stats.escapes.total, 5);
		assert.strictEqual(stats.escapes.streak, 3);
		assert.strictEqual(stats.escapes.longest, 3);
	});

	it("retire removes slot and keeps last 10 retired", () => {
		const slots: Slot[] = [
			{ id: "b1", title: "one", pitch: "p" },
			{ id: "b2", title: "two", pitch: "p" },
		];
		const stats: Stats = {
			nextId: 3,
			slots: new Map(),
			escapes: { total: 0, streak: 0, longest: 0 },
			retired: Array.from({ length: 10 }, (_, i) => ({
				id: `b${i + 10}`,
				title: `old ${i}`,
				when: "2026-01-01",
				reason: "done",
			})),
		};
		const result = retireSlot(stats, slots, "b1", "lost interest", "2026-10-15");
		assert.strictEqual(result.slots.length, 1);
		assert.strictEqual(result.stats.retired.length, 10);
		assert.strictEqual(result.stats.retired[0]?.id, "b1");
		assert.strictEqual(result.stats.retired[0]?.reason, "lost interest");
		assert.strictEqual(result.stats.retired[9]?.id, "b18");
	});

	it("addSlot generates fresh id and bumps nextId", () => {
		const stats: Stats = {
			nextId: 4,
			slots: new Map(),
			escapes: { total: 0, streak: 0, longest: 0 },
			retired: [],
		};
		const { slots, stats: newStats, slot } = addSlot(stats, [], { title: "new", pitch: "pitch", project: "proj" }, "2026-10-15");
		assert.strictEqual(slot.id, "b4");
		assert.strictEqual(newStats.nextId, 5);
		assert.strictEqual(slots[0]?.project, "proj");
	});

	it("updateSlot edits fields and removes empty optional fields", () => {
		const slots: Slot[] = [{ id: "b1", title: "t", pitch: "p", project: "x", context: "y" }];
		let updated = updateSlotField(slots, "b1", "title", "new title");
		assert.strictEqual(updated[0]?.title, "new title");
		updated = updateSlotField(updated, "b1", "project", "");
		assert.strictEqual(updated[0]?.project, undefined);
		updated = updateSlotField(updated, "b1", "context", "   ");
		assert.strictEqual(updated[0]?.context, undefined);
	});
});

describe("next.md helpers", () => {
	it("readNextFile parses task and project", () => {
		const dir = tmpDir();
		const path = join(dir, "next.md");
		writeFileSync(path, "next: do the thing\nproject: portfolio-manager\n", "utf-8");
		const parsed = readNextFile(path);
		assert.deepStrictEqual(parsed, { task: "do the thing", project: "portfolio-manager" });
	});

	it("writeNextFile omits project line when null", () => {
		const dir = tmpDir();
		const path = join(dir, "next.md");
		writeNextFile("task only", null, path);
		const content = readFileSync(path, "utf-8");
		assert.ok(content.includes("next: task only"));
		assert.ok(!content.includes("project:"));
	});

	it("treats project em-dash as null", () => {
		const dir = tmpDir();
		const path = join(dir, "next.md");
		writeFileSync(path, "next: task\nproject: —\n", "utf-8");
		assert.strictEqual(readNextFile(path)?.project, null);
	});
});

describe("formatting", () => {
	it("formatBeltSummary marks active slot, shows pitch, no duplicate Active line", () => {
		const slots: Slot[] = [{ id: "b1", title: "t", pitch: "p", project: "proj" }];
		const picked = formatBeltSummary(slots, { task: "t", project: "proj" }, { nextId: 2, slots: new Map(), escapes: { total: 0, streak: 0, longest: 0 }, retired: [] });
		assert.ok(picked.includes("→ b1 · t · proj"));
		assert.ok(picked.includes("   p"));
		assert.ok(!picked.includes("Active"));

		const escaped = formatBeltSummary(slots, { task: "other", project: null }, { nextId: 2, slots: new Map(), escapes: { total: 0, streak: 0, longest: 0 }, retired: [] });
		assert.ok(!escaped.includes("→"));
		assert.ok(escaped.includes("Active (off-belt): other"));

		const empty = formatBeltSummary([], null, { nextId: 1, slots: new Map(), escapes: { total: 0, streak: 0, longest: 0 }, retired: [] });
		assert.ok(empty.includes("Belt (0/3):"));
		assert.ok(empty.includes("(empty)"));

		const longTitle = "x".repeat(200);
		const truncated = formatBeltSummary([{ id: "b1", title: longTitle, pitch: "p" }], null, { nextId: 2, slots: new Map(), escapes: { total: 0, streak: 0, longest: 0 }, retired: [] });
		assert.ok(!truncated.includes("x".repeat(61)));
	});

	it("slotMeta format", () => {
		const stats: Stats = {
			nextId: 2,
			slots: new Map([["b1", { picks: 9, added: "2026-10-03", last: "2026-10-12" }]]),
			escapes: { total: 0, streak: 0, longest: 0 },
			retired: [],
		};
		const meta = slotMeta({ id: "b1", title: "t", pitch: "p" }, stats, "2026-10-15");
		assert.strictEqual(meta, "×9 picks · on belt 12d · last picked 3d ago");
	});

	it("slotMeta omits last-picked when never picked", () => {
		const stats: Stats = {
			nextId: 2,
			slots: new Map([["b1", { picks: 0, added: "2026-10-10" }]]),
			escapes: { total: 0, streak: 0, longest: 0 },
			retired: [],
		};
		const meta = slotMeta({ id: "b1", title: "t", pitch: "p" }, stats, "2026-10-15");
		assert.strictEqual(meta, "×0 picks · on belt 5d");
		assert.ok(!meta.includes("last picked"));
	});

	it("formatPickInjection includes optional parts", () => {
		const withAll: Slot = { id: "b1", title: "t", pitch: "p", project: "proj", context: "ctx" };
		assert.strictEqual(formatPickInjection(withAll), "Working on t (proj). Pitch: p. Context: ctx.");

		const minimal: Slot = { id: "b1", title: "t", pitch: "p" };
		assert.strictEqual(formatPickInjection(minimal), "Working on t. Pitch: p.");
	});

	it("formatEscapeNotify", () => {
		const stats: Stats = {
			nextId: 1,
			slots: new Map(),
			escapes: { total: 7, streak: 3, longest: 5 },
			retired: [],
		};
		assert.strictEqual(formatEscapeNotify(stats), "escape ×7 — streak 3");
	});

	it("truncatePlain", () => {
		assert.strictEqual(truncatePlain("hello", 10), "hello");
		assert.strictEqual(truncatePlain("hello world", 6), "hello…");
	});
});

describe("reconcile", () => {
	it("adds missing slot entry with picks 0", () => {
		const stats = parseStats(FIXTURE_STATS_CORRUPTED);
		const { slots } = parseBelt(FIXTURE_BELT);
		reconcileStats(stats, slots, "2026-10-15");
		assert.strictEqual(stats.slots.has("b2"), true);
		assert.strictEqual(stats.slots.get("b2")?.picks, 0);
		assert.strictEqual(stats.slots.get("b2")?.added, "2026-10-15");
	});
});

describe("import audit", () => {
	it("files.ts and picker-state.ts import only node:* builtins or each other", async () => {
		const fs = await import("node:fs");
		const filesSrc = fs.readFileSync(new URL("./files.ts", import.meta.url), "utf-8");
		const pickerSrc = fs.readFileSync(new URL("./picker-state.ts", import.meta.url), "utf-8");

		function assertClean(src: string, label: string) {
			for (const line of src.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("import ")) continue;
				// Allow node:* builtins and relative imports within the module pair.
				if (
					trimmed.includes('from "node:') ||
					trimmed.includes("from 'node:") ||
					trimmed.includes('from "./files.ts"') ||
					trimmed.includes('from "./picker-state.ts"') ||
					trimmed.includes("from './files.ts'") ||
					trimmed.includes("from './picker-state.ts'")
				) {
					continue;
				}
				// Allow bare type-only imports.
				if (trimmed.startsWith("import type ")) continue;
				throw new Error(`${label} has forbidden import: ${trimmed}`);
			}
		}

		assertClean(filesSrc, "files.ts");
		assertClean(pickerSrc, "picker-state.ts");
	});
});
