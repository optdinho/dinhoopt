// Local tool: lists git-changed files in the worktree.
//
// This project uses an OpenCode **V2** runtime (>= 2.0). Tools registered through
// `ctx.tool.transform("editor.add")` are plain definitions:
//
//   {
//     name,                          // unique tool name
//     description,                   // shown to the model
//     input: JSON schema,            // validates the tool arguments
//     execute(input, ctx) => { content }
//   }
//
// The old V1 `tool()` helper (from @opencode-ai/plugin) is NOT supported in V2
// and its tools never load — do not reintroduce that pattern.

import { execSync } from "node:child_process";

interface ChangedFilesInput {
	/** Optional directory to run git in. Defaults to the current worktree root. */
	cwd?: string;
}

const inputSchema = {
	type: "object",
	properties: {
		cwd: {
			type: "string",
			description: "Optional directory to run git in. Defaults to the current worktree root.",
		},
	},
	required: [],
} as const;

const BRANCH_PREFIXES = ["feat/", "feature/", "fix/", "hotfix/"];

function listChangedFiles(cwd?: string): { files: string[]; error?: string } {
	try {
		const out = execSync("git status --porcelain", {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const files = out
			.split(/\r?\n/u)
			.filter((line) => line.length > 0)
			.map((line) => line.slice(3))
			.filter((p) => p.length > 0);
		return { files };
	} catch (err) {
		const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
		return { files: [], error: message };
	}
}

function currentBranch(cwd?: string): string | undefined {
	try {
		const out = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const b = out.trim();
		return b.length > 0 && b !== "HEAD" ? b : undefined;
	} catch {
		return undefined;
	}
}

export default {
	name: "changed-files",
	description:
		"Lists files changed in the git working tree (staged, unstaged and untracked). " +
		"Optionally filtered by path prefix.",
	input: inputSchema,
	async execute(rawInput: unknown) {
		const input = (rawInput ?? {}) as ChangedFilesInput;
		const { files, error } = listChangedFiles(input?.cwd);

		if (error) {
			return {
				content: `Error listing changed files: ${error}`,
			};
		}

		if (files.length === 0) {
			return {
				content: "No changed files in the working tree.",
			};
		}

		const branch = currentBranch(input?.cwd);
		const isWorkBranch = branch ? BRANCH_PREFIXES.some((p) => branch.startsWith(p)) : false;
		const prefix = branch ? `${isWorkBranch ? "[work] " : ""}${branch} ` : "";
		const lines = files.map((f) => `${prefix}${f}`);

		return {
			content: lines.join("\n"),
		};
	},
};
