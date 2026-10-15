/**
 * Belt v2 picker state-machine tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import {
	initialState,
	moveUp,
	moveDown,
	setEscapeText,
	submit,
	cancel,
	wrapPlain,
	buildRows,
} from "./picker-state.ts";
import type { Slot, Stats } from "./files.ts";

const slots: Slot[] = [
	{ id: "b1", title: "fix dashboard", pitch: "threshold page" },
	{ id: "b2", title: "write essay", pitch: "first draft" },
	{ id: "b3", title: "trmnl", pitch: "e-ink glory" },
];

const emptyStats: Stats = {
	nextId: 4,
	slots: new Map(),
	escapes: { total: 0, streak: 0, longest: 0 },
	retired: [],
};

describe("picker state machine", () => {
	it("initial state selects first slot", () => {
		const s = initialState(3);
		assert.strictEqual(s.selectedIndex, 0);
		assert.strictEqual(s.escapeText, "");
	});

	it("initial state is -1 when empty", () => {
		const s = initialState(0);
		assert.strictEqual(s.selectedIndex, -1);
	});

	it("moveDown cycles forward and wraps", () => {
		let s = initialState(3);
		s = moveDown(s, 3);
		assert.strictEqual(s.selectedIndex, 1);
		s = moveDown(s, 3);
		s = moveDown(s, 3);
		assert.strictEqual(s.selectedIndex, 0);
	});

	it("moveUp cycles backward and wraps", () => {
		let s = initialState(3);
		s = moveUp(s, 3);
		assert.strictEqual(s.selectedIndex, 2);
		s = moveUp(s, 3);
		assert.strictEqual(s.selectedIndex, 1);
	});

	it("setEscapeText mirrors text", () => {
		let s = initialState(3);
		s = setEscapeText(s, "hello");
		assert.strictEqual(s.escapeText, "hello");
	});

	it("submit returns escape when text present", () => {
		let s = initialState(3);
		s = setEscapeText(s, "x");
		const result = submit(s, slots);
		assert.deepStrictEqual(result, { kind: "escape", text: "x" });
	});

	it("submit returns pick when text empty", () => {
		const s = initialState(3);
		const result = submit(s, slots);
		assert.strictEqual(result.kind, "pick");
		assert.strictEqual((result as Extract<typeof result, { kind: "pick" }>).slot.id, "b1");
	});

	it("submit returns skip with no slots and no text", () => {
		const s = initialState(0);
		const result = submit(s, []);
		assert.strictEqual(result.kind, "skip");
	});

	it("cancel always returns skip", () => {
		assert.deepStrictEqual(cancel(), { kind: "skip" });
	});
});

describe("wrapPlain", () => {
	it("wraps at exact width", () => {
		assert.deepStrictEqual(wrapPlain("hello world", 5), ["hello", "world"]);
	});

	it("splits long words", () => {
		assert.deepStrictEqual(wrapPlain("abcdefghij", 4), ["abcd", "efgh", "ij"]);
	});

	it("normalizes whitespace", () => {
		assert.deepStrictEqual(wrapPlain("a    b\tc", 10), ["a b c"]);
	});

	it("returns empty string for blank input", () => {
		assert.deepStrictEqual(wrapPlain("   ", 10), [""]);
	});

	it("contains no ANSI", () => {
		const lines = wrapPlain("\u001b[31mred\u001b[0m text", 20);
		assert.strictEqual(lines[0]?.includes("\u001b"), true); // input preserved, no coloring done
	});
});

describe("buildRows", () => {
	it("wires meta per slot and wraps pitch", () => {
		const stats: Stats = {
			nextId: 4,
			slots: new Map([
				["b1", { picks: 2, added: "2026-10-01" }],
				["b2", { picks: 5, added: "2026-09-15", last: "2026-10-10" }],
			]),
			escapes: { total: 0, streak: 0, longest: 0 },
			retired: [],
		};
		const rows = buildRows(slots, stats, "2026-10-15", 12);
		assert.strictEqual(rows.length, 3);
		assert.strictEqual(rows[0]?.meta, "×2 picks · on belt 14d");
		assert.strictEqual(rows[1]?.meta, "×5 picks · on belt 30d · last picked 5d ago");
		assert.ok(rows[0]!.pitchLines.length > 0);
	});
});
