/**
 * Belt v2 — thin system shell.
 *
 * Local filesystem helpers + fire-and-forget threshold regeneration.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __ext_dir = dirname(fileURLToPath(import.meta.url));

export let THRESHOLD_DIR = join(__ext_dir, "..", "..", "threshold");
if (!existsSync(join(THRESHOLD_DIR, "sync.mjs"))) {
	const fallback = join(homedir(), "Documents ", "Bawa's Lab", "threshold");
	if (existsSync(join(fallback, "sync.mjs"))) {
		THRESHOLD_DIR = fallback;
	}
}

// Curated project list — the picker's only source. Add/remove by hand as
// projects come alive or retire. (2026-10-15: replaced get_repos.mjs, which
// listed every git repo in the Lab — 48 entries full of graveyard stuff.)
const PROJECTS = [
	"Bawa's Lab",
	"flat-letter",
	"bawas-porch",
	"personal-site",
	"project-norma",
	"pi-agenttrail",
	"threshold",
];

export function getProjectRepos(): string[] {
	return [...PROJECTS];
}

export function inferProjectFromCwd(cwd: string, repos: string[]): string | null {
	const lowerCwd = cwd.toLowerCase();
	for (const proj of repos) {
		if (lowerCwd.includes(proj.toLowerCase())) return proj;
	}
	return null;
}

export function regenThreshold(): void {
	try {
		const child = spawn(process.execPath, ["sync.mjs"], {
			cwd: THRESHOLD_DIR,
			stdio: "ignore",
			detached: true,
		});
		child.on("error", () => {});
		child.unref();
	} catch {
		// silent fail
	}
}
