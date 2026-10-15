/**
 * Belt v2 — TUI picker shell.
 *
 * Cloned from pi's official questionnaire example
 * (examples/extensions/questionnaire.ts in the pi install) — the sanctioned
 * wizard pattern: prompt, options with wrapped descriptions, a built-in
 * "Type something else" escape option with an editor, and pi's own width
 * utilities (wrapTextWithAnsi / visibleWidth). Full-width inline custom
 * screen (no overlay centering math, no hand-drawn box borders).
 *
 * Only file importing pi-tui at value level. All logic lives in
 * picker-state.ts (pure) and files.ts (pure) — this is the iteration surface.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	Key,
	matchesKey,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type EditorTheme,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";

import type { NextTask, Slot, Stats } from "./files.ts";
import { slotMeta } from "./files.ts";
import { initialState, moveDown, moveUp, setEscapeText, type PickerResult } from "./picker-state.ts";

interface BeltOverlayProps {
	slots: Slot[];
	stats: Stats;
	mode: "pick" | "view";
	next?: NextTask | null;
	done: (result: PickerResult) => void;
}

function createEditorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (s: string) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t: string) => theme.fg("accent", t),
			selectedText: (t: string) => theme.fg("accent", t),
			description: (t: string) => theme.fg("muted", t),
			scrollInfo: (t: string) => theme.fg("dim", t),
			noMatch: (t: string) => theme.fg("warning", t),
		},
	};
}

function todayLocal(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

class BeltOverlay implements Component {
	private tui: TUI;
	private theme: Theme;
	private keybindings: KeybindingsManager;
	private slots: Slot[];
	private stats: Stats;
	private mode: "pick" | "view";
	private activeTitle?: string;
	private done: (result: PickerResult) => void;
	private state = initialState(0);
	private inputMode = false;
	private editor: Editor;
	private cachedLines?: string[];
	private _focused = false;
	private prompt: string;

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		{ slots, stats, mode, next, done }: BeltOverlayProps,
	) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.slots = slots;
		this.stats = stats;
		this.mode = mode;
		this.activeTitle = next?.task;
		this.done = done;
		this.prompt = mode === "pick" ? "What are you working on?" : "Belt";
		this.state = initialState(slots.length);
		this.editor = new Editor(tui, createEditorTheme(theme));
		this.editor.disableSubmit = true;
		this.editor.onChange = (text: string) => {
			this.state = setEscapeText(this.state, text);
			this.refresh();
		};
	}

	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		(this.editor as any).focused = this.inputMode ? value : false;
	}

	/** options = slots + the "Type something else" row (pick mode only) */
	private get optionCount(): number {
		return this.slots.length + (this.mode === "pick" ? 1 : 0);
	}

	private refresh(): void {
		this.cachedLines = undefined;
		this.tui.requestRender();
	}

	invalidate(): void {
		this.cachedLines = undefined;
		this.editor.invalidate();
	}

	handleInput(data: string): void {
		// Esc / cancel — always leaves the picker without counting anything
		if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
			this.done({ kind: "skip" });
			return;
		}

		// Input mode (typing an escape task): Enter submits the text, empty stays
		if (this.inputMode) {
			if (this.keybindings.matches(data, "tui.select.confirm") || matchesKey(data, Key.enter)) {
				const text = this.state.escapeText.trim();
				if (text) {
					this.done({ kind: "escape", text });
					return;
				}
				return;
			}
			this.editor.handleInput(data);
			return;
		}

		if (this.keybindings.matches(data, "tui.select.confirm") || matchesKey(data, Key.enter)) {
			const idx = this.state.selectedIndex;
			if (this.mode === "pick" && idx === this.slots.length) {
				// "Type something else" row selected — switch to typing
				this.inputMode = true;
				this.editor.setText("");
				(this.editor as any).focused = true;
				this.refresh();
				return;
			}
			const slot = this.slots[idx];
			if (slot) {
				this.done({ kind: "pick", slot });
			} else {
				// view mode with a stray index: just close
				this.done({ kind: "skip" });
			}
			return;
		}

		if (this.keybindings.matches(data, "tui.select.up") || matchesKey(data, Key.up)) {
			this.state = moveUp(this.state, this.optionCount);
			this.refresh();
			return;
		}

		if (this.keybindings.matches(data, "tui.select.down") || matchesKey(data, Key.down)) {
			this.state = moveDown(this.state, this.optionCount);
			this.refresh();
			return;
		}
	}

	render(width: number): string[] {
		if (this.cachedLines) return this.cachedLines;

		const lines: string[] = [];
		const renderWidth = Math.max(1, width);
		const today = todayLocal();

		function addWrapped(text: string) {
			lines.push(...wrapTextWithAnsi(text, renderWidth));
		}

		function addWrappedWithPrefix(prefix: string, text: string) {
			const prefixWidth = visibleWidth(prefix);
			if (prefixWidth >= renderWidth) {
				addWrapped(prefix + text);
				return;
			}
			const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
			const continuation = " ".repeat(prefixWidth);
			for (let i = 0; i < wrapped.length; i++) {
				lines.push(`${i === 0 ? prefix : continuation}${wrapped[i]}`);
			}
		}

		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)));
		addWrappedWithPrefix(" ", this.theme.fg("text", this.prompt));
		if (this.stats.escapes.streak > 0) {
			addWrappedWithPrefix(
				" ",
				this.theme.fg("dim", `escape streak ${this.stats.escapes.streak} · total ${this.stats.escapes.total}`),
			);
		}
		lines.push("");

		if (this.slots.length === 0) {
			addWrappedWithPrefix(" ", this.theme.fg("muted", "belt is empty — use /next <task> to add"));
		} else {
			for (let i = 0; i < this.slots.length; i++) {
				const s = this.slots[i]!;
				const selected = !this.inputMode && i === this.state.selectedIndex;
				const active = this.activeTitle === s.title;
				const prefix = selected
					? this.theme.fg("accent", "> ")
					: active
						? this.theme.fg("accent", "→ ")
						: "  ";
				const label = this.theme.fg(selected ? "accent" : "text", `${i + 1}. ${s.id} · ${s.title}`);
				addWrappedWithPrefix(prefix, label);

				const meta = slotMeta(s, this.stats, today);
				addWrappedWithPrefix("     ", this.theme.fg("muted", `${s.pitch} — ${meta}`));
			}

			if (this.mode === "pick") {
				const i = this.slots.length;
				const selected = !this.inputMode && i === this.state.selectedIndex;
				const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
				const label = this.theme.fg(
					selected ? "accent" : "text",
					`${i + 1}. ✎ Type something else${this.inputMode ? " ✎" : ""}`,
				);
				addWrappedWithPrefix(prefix, label);
			}
		}

		lines.push("");

		if (this.inputMode) {
			addWrappedWithPrefix(" ", this.theme.fg("muted", "Your task:"));
			for (const line of this.editor.render(Math.max(1, renderWidth - 2))) {
				lines.push(` ${line}`);
			}
			lines.push("");
			addWrappedWithPrefix(
				" ",
				this.theme.fg("dim", "Enter to start on this task • Esc to skip the picker"),
			);
		} else {
			const help =
				this.mode === "pick"
					? "↑↓ navigate • Enter select • Esc skip"
					: "↑↓ navigate • Enter/Esc close";
			addWrappedWithPrefix(" ", this.theme.fg("dim", help));
		}

		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)));

		this.cachedLines = lines;
		return lines;
	}
}

export interface ShowOverlayOptions {
	mode: "pick" | "view";
	slots: Slot[];
	stats: Stats;
	next?: NextTask | null;
}

export function showBeltOverlay(
	ctx: { ui: { custom: <T>(factory: any, options?: any) => Promise<T> } },
	{ mode, slots, stats, next }: ShowOverlayOptions,
): Promise<PickerResult> {
	return ctx.ui.custom<PickerResult>(
		(tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: PickerResult) => void) =>
			new BeltOverlay(tui, theme, keybindings, { slots, stats, mode, next, done }),
	);
}
