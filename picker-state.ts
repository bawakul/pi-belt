/**
 * Belt v2 — picker state machine.
 *
 * Pure: no pi-tui, no pi imports. Imports files.ts for types only.
 */

import type { Slot, Stats } from "./files.ts";

export type PickerResult =
	| { kind: "pick"; slot: Slot }
	| { kind: "escape"; text: string }
	| { kind: "skip" };

export interface PickerState {
	selectedIndex: number;
	escapeText: string;
}

export interface RowLayout {
	title: string;
	pitchLines: string[];
	meta: string;
}

export function initialState(slotCount: number): PickerState {
	return {
		selectedIndex: slotCount > 0 ? 0 : -1,
		escapeText: "",
	};
}

export function moveUp(state: PickerState, slotCount: number): PickerState {
	if (slotCount <= 0) return state;
	return {
		...state,
		selectedIndex: state.selectedIndex <= 0 ? slotCount - 1 : state.selectedIndex - 1,
	};
}

export function moveDown(state: PickerState, slotCount: number): PickerState {
	if (slotCount <= 0) return state;
	return {
		...state,
		selectedIndex: state.selectedIndex >= slotCount - 1 ? 0 : state.selectedIndex + 1,
	};
}

export function setEscapeText(state: PickerState, text: string): PickerState {
	return { ...state, escapeText: text };
}

export function submit(state: PickerState, slots: Slot[]): PickerResult {
	const trimmed = state.escapeText.trim();
	if (trimmed) {
		return { kind: "escape", text: trimmed };
	}
	if (state.selectedIndex >= 0 && state.selectedIndex < slots.length) {
		return { kind: "pick", slot: slots[state.selectedIndex] as Slot };
	}
	return { kind: "skip" };
}

export function cancel(): PickerResult {
	return { kind: "skip" };
}

export function wrapPlain(text: string, width: number): string[] {
	if (!text.trim()) return [""];
	const normalized = text.replace(/\s+/g, " ").trim();
	if (width <= 1) return normalized.split("");

	const words = normalized.split(" ");
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		if (!current) {
			if (word.length <= width) {
				current = word;
			} else {
				for (let i = 0; i < word.length; i += width) {
					lines.push(word.slice(i, i + width));
				}
			}
			continue;
		}

		const candidate = `${current} ${word}`;
		if (candidate.length <= width) {
			current = candidate;
			continue;
		}

		lines.push(current);
		if (word.length <= width) {
			current = word;
		} else {
			current = "";
			for (let i = 0; i < word.length; i += width) {
				const chunk = word.slice(i, i + width);
				if (chunk.length === width || i + width < word.length) {
					lines.push(chunk);
				} else {
					current = chunk;
				}
			}
		}
	}

	if (current) lines.push(current);
	return lines;
}

function daysBetween(a: string, b: string): number {
	const [ay, am, ad] = a.split("-").map((x) => parseInt(x, 10));
	const [by, bm, bd] = b.split("-").map((x) => parseInt(x, 10));
	const ms = new Date(by as number, (bm as number) - 1, bd as number).getTime() - new Date(ay as number, (am as number) - 1, ad as number).getTime();
	return Math.max(0, Math.floor(ms / 86_400_000));
}

export function slotMetaForRow(slot: Slot, stats: Stats, today: string): string {
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

export function buildRows(
	slots: Slot[],
	stats: Stats,
	today: string,
	width: number,
): RowLayout[] {
	return slots.map((slot) => {
		const pitchLines = wrapPlain(slot.pitch, Math.max(0, width));
		return {
			title: slot.title,
			pitchLines,
			meta: slotMetaForRow(slot, stats, today),
		};
	});
}
