/**
 * Belt v2 extension entry point.
 *
 * Wires event handlers, registers /next, owns module-level session state.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	BeforeAgentStartEventResult,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import {
	readBeltAndStats,
	readStats,
	writeStats,
	writeNextFile,
	readNextFile,
	migrateIfNeeded,
	pickSlot,
	recordEscape,
	formatPickInjection,
	formatBeltSummary,
	formatEscapeNotify,
	DEFAULT_BELT_FILE,
	DEFAULT_STATS_FILE,
	DEFAULT_NEXT_FILE,
} from "./files.ts";
import type { Slot } from "./files.ts";
import { cmdList, cmdAdd, cmdDone, cmdEdit, promptFirstSlot, repairBelt } from "./commands.ts";
import { regenThreshold, getProjectRepos, inferProjectFromCwd } from "./system.ts";
import type { PickerResult } from "./picker-state.ts";

let pendingChoice: Slot | undefined;
let injectedThisSession = false;

async function applyPickerResult(
	ctx: ExtensionContext,
	result: PickerResult,
	rearm: boolean,
): Promise<void> {
	if (result.kind === "pick") {
		const slot = result.slot;
		const stats = readStats(DEFAULT_STATS_FILE);
		pickSlot(stats, slot);
		writeStats(stats, DEFAULT_STATS_FILE);
		writeNextFile(slot.title, slot.project ?? null, DEFAULT_NEXT_FILE);
		regenThreshold();
		pendingChoice = slot;
		if (rearm) injectedThisSession = false;
		ctx.ui.notify(`✓ ${slot.title}`, "info");
		return;
	}

	if (result.kind === "escape") {
		const stats = readStats(DEFAULT_STATS_FILE);
		recordEscape(stats);
		writeStats(stats, DEFAULT_STATS_FILE);
		const project = inferProjectFromCwd(ctx.cwd, getProjectRepos());
		writeNextFile(result.text, project, DEFAULT_NEXT_FILE);
		regenThreshold();
		if (rearm) injectedThisSession = false;
		ctx.ui.notify(formatEscapeNotify(stats), "info");
		return;
	}

	// skip: no counters, no writes.
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
		pendingChoice = undefined;
		injectedThisSession = false;

		if (ctx.mode !== "tui") return;
		if (event.reason === "reload") return;

		migrateIfNeeded();
		let read = readBeltAndStats(DEFAULT_BELT_FILE, DEFAULT_STATS_FILE);

		if (!read.valid) {
			const repaired = await repairBelt(ctx, read);
			if (!repaired) return;
			read = repaired;
		}

		if (read.slots.length === 0) {
			const added = await promptFirstSlot(ctx);
			if (!added) return;
			read = added;
		}

		const { showBeltOverlay } = await import("./ui-picker.ts");
		showBeltOverlay(ctx, { mode: "pick", slots: read.slots, stats: read.stats })
			.then((result) => applyPickerResult(ctx, result, false))
			.catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`belt picker error: ${msg}`, "warning");
			});
	});

	pi.on("before_agent_start", async (_event, _ctx) => {
		if (injectedThisSession) return undefined;
		injectedThisSession = true;

		if (pendingChoice) {
			return {
				message: {
					customType: "belt-next-action",
					content: formatPickInjection(pendingChoice),
					display: true,
				},
			} as BeforeAgentStartEventResult;
		}

		const belt = readBeltAndStats(DEFAULT_BELT_FILE, DEFAULT_STATS_FILE);
		const next = readNextFile(DEFAULT_NEXT_FILE);
		return {
			message: {
				customType: "belt-summary",
				content: formatBeltSummary(belt.slots, next, belt.stats),
				display: true,
			},
		} as BeforeAgentStartEventResult;
	});

	pi.registerCommand("next", {
		description: "Belt task management: /next, /next <task>, /next done, /next edit",
		handler: async (args, ctx) => {
			const trimmed = args?.trim() ?? "";
			if (!trimmed) {
				const result = await cmdList(ctx);
				await applyPickerResult(ctx, result, true);
				return;
			}
			if (trimmed === "done") {
				await cmdDone(ctx);
				return;
			}
			if (trimmed === "edit") {
				await cmdEdit(ctx);
				return;
			}
			await cmdAdd(ctx, trimmed);
		},
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		regenThreshold();
	});
}
