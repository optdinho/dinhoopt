/**
 * ECC Plugin Hooks for OpenCode — V2 plugin API port.
 *
 * The original plugin targeted the V1 API (`setup(ctx)` returning a hooks
 * object, `$` template helper, `client.app.log`, `tool()` definitions). OpenCode
 * 2.x **ignores** the return value of `setup()` (only a cleanup function is
 * used), so the V1-style plugin loaded but wired nothing. This port registers
 * everything explicitly through the V2 context domains.
 *
 * Hook mapping (V1 → V2):
 * - file.edited / file.watcher.updated → `filesystem.changed` event
 * - tool.execute.before / after        → `ctx.tool.hook('execute.*')`
 * - shell.env                          → `ctx.shell.hook('create.before')`
 * - permission.ask                     → `ctx.permission.hook('evaluate')`
 * - experimental.session.compacting    → `ctx.session.hook('compaction')`
 * - session.created / idle / deleted   → same-name events (worktree-filtered)
 * - tool: { 'changed-files' }          → `ctx.tool.transform((e) => e.add(...))`
 * - todo.updated                       → dropped (no V2 equivalent)
 *
 * Logging goes to the console AND to `$TMP/opencode/ecc-hooks.log`, because it
 * is not guaranteed that plugin console output reaches `opencode.log`.
 */

import { exec } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { Plugin } from '@opencode/plugin'
import changedFilesTool from '../tools/changed-files.js'
import { clearChanges, initStore, recordChange } from './lib/changed-files-store.js'

const execAsync = promisify(exec)

type HookProfile = 'minimal' | 'standard' | 'strict'

const LOG_FILE = path.join(os.tmpdir(), 'opencode', 'ecc-hooks.log')
const ALL_PROFILES: HookProfile[] = ['minimal', 'standard', 'strict']
const READ_ONLY_TOOLS = new Set(['read', 'glob', 'grep', 'search', 'list', 'ls', 'find', 'tree'])
const LONG_RUNNING_RE = /^(npm|pnpm|yarn|bun)\s+(install|build|test|run)|^(cargo|go)\s+(build|test|run)/
const FORMATTER_RE = /^(npx\s+)?(prettier|biome|black|gofmt|rustfmt|swift-format)\b/
const TEST_RE = /^(npm test|npm run test|npx vitest|npx jest|pytest|go test|cargo test)\b/

/** Log to console + a file in the temp dir. Never throws into the host. */
function log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
	const write = console[level]
	if (typeof write === 'function') {
		try {
			write.call(console, `[ECC] ${message}`)
		} catch {
			/* console may be unavailable inside the server host */
		}
	}
	try {
		fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
		fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`)
	} catch {
		/* logging must never break the host */
	}
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message.split('\n')[0] ?? err.message
	return String(err)
}

/** Count `console.log` occurrences in a file without shelling out to grep. */
function countConsoleLogs(absolutePath: string): number {
	try {
		const text = fs.readFileSync(absolutePath, 'utf8')
		const matches = text.match(/console\.log/g)
		return matches ? matches.length : 0
	} catch {
		return 0
	}
}

export default Plugin.define({
	id: 'ecc-hooks',
	async setup(ctx) {
		const worktreePath = String(ctx.location.directory)
		initStore(worktreePath)

		const editedFiles = new Set<string>()
		const pendingToolChanges = new Map<string, { path: string; type: 'added' | 'modified' }>()
		const disposers: Array<() => Promise<void>> = []

		function resolvePath(p: string): string {
			return path.isAbsolute(p) ? p : path.join(worktreePath, p)
		}

		function hasProjectFile(relativePath: string): boolean {
			try {
				return fs.statSync(resolvePath(relativePath)).isFile()
			} catch {
				return false
			}
		}

		function getFilePath(args: Record<string, unknown> | undefined): string | null {
			if (!args) return null
			const p = (args.filePath ?? args.file_path ?? args.path) as string | undefined
			return typeof p === 'string' && p.trim() ? p : null
		}

		function isShellTool(tool: string): boolean {
			return tool === 'bash' || tool === 'shell'
		}

		function isForThisWorktree(dir: string | undefined): boolean {
			if (!dir) return true
			const a = path.resolve(dir).toLowerCase()
			const b = path.resolve(worktreePath).toLowerCase()
			return a === b
		}

		const normalizeProfile = (value: string | undefined): HookProfile => {
			if (value === 'minimal' || value === 'strict') return value
			return 'standard'
		}

		const currentProfile = normalizeProfile(process.env.ECC_HOOK_PROFILE)
		const disabledHooks = new Set(
			(process.env.ECC_DISABLED_HOOKS || '')
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean),
		)

		const profileOrder: Record<HookProfile, number> = { minimal: 0, standard: 1, strict: 2 }

		const profileAllowed = (required: HookProfile | HookProfile[]): boolean => {
			if (Array.isArray(required)) {
				return required.some((entry) => profileOrder[currentProfile] >= profileOrder[entry])
			}
			return profileOrder[currentProfile] >= profileOrder[required]
		}

		const hookEnabled = (hookId: string, requiredProfile: HookProfile | HookProfile[] = 'standard'): boolean => {
			if (disabledHooks.has(hookId)) return false
			return profileAllowed(requiredProfile)
		}

		/** Track a hook/transform registration so cleanup can dispose all of them. */
		async function track(registration: Promise<{ dispose: () => Promise<void> }>): Promise<void> {
			const reg = await registration
			disposers.push(() => reg.dispose())
		}

		async function formatFile(absolutePath: string): Promise<void> {
			try {
				await execAsync(`npx prettier --write "${absolutePath}"`, { cwd: worktreePath, timeout: 60_000 })
				log('info', `Formatted: ${absolutePath}`)
			} catch {
				// Prettier not installed or failed - silently continue
			}
		}

		async function typecheck(): Promise<void> {
			try {
				await execAsync('npx tsc --noEmit', { cwd: worktreePath, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
				log('info', 'TypeScript check passed')
			} catch (error: unknown) {
				const err = error as { stdout?: string }
				log('warn', 'TypeScript errors detected:')
				for (const line of (err.stdout || '').split('\n').slice(0, 5)) {
					if (line.trim()) log('warn', `  ${line}`)
				}
			}
		}

		function buildShellEnv(): Record<string, string> {
			const env: Record<string, string> = {
				ECC_VERSION: '1.8.0',
				ECC_PLUGIN: 'true',
				ECC_HOOK_PROFILE: currentProfile,
				ECC_DISABLED_HOOKS: process.env.ECC_DISABLED_HOOKS || '',
				PROJECT_ROOT: worktreePath,
			}

			const lockfiles: Record<string, string> = {
				'bun.lockb': 'bun',
				'pnpm-lock.yaml': 'pnpm',
				'yarn.lock': 'yarn',
				'package-lock.json': 'npm',
			}
			for (const [lockfile, pm] of Object.entries(lockfiles)) {
				if (hasProjectFile(lockfile)) {
					env.PACKAGE_MANAGER = pm
					break
				}
			}

			const langDetectors: Record<string, string> = {
				'tsconfig.json': 'typescript',
				'go.mod': 'go',
				'pyproject.toml': 'python',
				'Cargo.toml': 'rust',
				'Package.swift': 'swift',
			}
			const detected: string[] = []
			for (const [file, lang] of Object.entries(langDetectors)) {
				if (hasProjectFile(file)) detected.push(lang)
			}
			if (detected.length > 0) {
				env.DETECTED_LANGUAGES = detected.join(',')
				env.PRIMARY_LANGUAGE = detected[0]
			}
			return env
		}

		function buildCompactionContext(): string {
			const block = [
				'# ECC Context (preserve across compaction)',
				'',
				'## Active Plugin: ECC (OpenCode V2 hooks)',
				'- Hooks: tool.execute.before/after, shell env injection, permission evaluate, compaction context, session lifecycle, filesystem change tracking',
				'- Tools: changed-files',
				'',
				'## Key Principles',
				'- TDD: write tests first, 80%+ coverage',
				'- Immutability: never mutate, always return new copies',
				'- Security: validate inputs, no hardcoded secrets',
				'',
				'Preserve: current task status, key decisions, files created/modified, remaining work, security concerns. Discard: verbose tool outputs, intermediate exploration.',
				'',
			]
			if (editedFiles.size > 0) {
				block.push('## Recently Edited Files')
				for (const f of editedFiles) block.push(`- ${f}`)
				block.push('')
			}
			return block.join('\n')
		}

		function auditConsoleLogs(): void {
			if (!hookEnabled('stop:check-console-log', ALL_PROFILES)) return
			if (editedFiles.size === 0) return

			log('info', 'Session idle - running console.log audit')
			let total = 0
			const filesWithConsoleLogs: string[] = []
			for (const file of editedFiles) {
				if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue
				const count = countConsoleLogs(resolvePath(file))
				if (count > 0) {
					total += count
					filesWithConsoleLogs.push(file)
				}
			}
			if (total > 0) {
				log('warn', `Audit: ${total} console.log statement(s) in ${filesWithConsoleLogs.length} file(s)`)
				for (const f of filesWithConsoleLogs) log('warn', `  - ${f}`)
				log('warn', 'Remove console.log statements before committing')
			} else {
				log('info', 'Audit passed: No console.log statements found')
			}
			editedFiles.clear()
		}

		// --- Pre-tool hook: track writes, warn about doc files --------------------
		await track(
			ctx.tool.hook('execute.before', (event) => {
				const input = (event.input ?? {}) as Record<string, unknown>
				const filePath = getFilePath(input)

				if (event.tool === 'write' && filePath) {
					const abs = resolvePath(filePath)
					let type: 'added' | 'modified' = 'modified'
					try {
						type = fs.existsSync(abs) ? 'modified' : 'added'
					} catch {
						type = 'modified'
					}
					pendingToolChanges.set(String(event.id), { path: filePath, type })
				}

				if (
					hookEnabled('pre:write:doc-file-warning', ['standard', 'strict']) &&
					event.tool === 'write' &&
					filePath &&
					/\.(md|txt)$/i.test(filePath) &&
					!/(README|CHANGELOG|LICENSE|CONTRIBUTING)/i.test(filePath)
				) {
					log('warn', `Creating ${filePath} - consider if this documentation is necessary`)
				}
			}),
		)

		// --- Post-tool hook: change tracking, console audit, format, typecheck ---
		await track(
			ctx.tool.hook('execute.after', async (event) => {
				const input = (event.input ?? {}) as Record<string, unknown>
				const filePath = getFilePath(input)
				const key = String(event.id)

				if (event.tool === 'edit' && filePath) {
					recordChange(filePath, 'modified')
				}

				if (event.tool === 'write' && filePath) {
					const pending = pendingToolChanges.get(key)
					if (pending) {
						recordChange(pending.path, pending.type)
						pendingToolChanges.delete(key)
					} else {
						recordChange(filePath, 'modified')
					}
				}

				if ((event.tool === 'edit' || event.tool === 'write') && filePath && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
					if (hookEnabled('post:edit:console-warn', ['standard', 'strict'])) {
						const count = countConsoleLogs(resolvePath(filePath))
						if (count > 0) {
							log('warn', `console.log found in ${filePath} (${count} occurrence${count > 1 ? 's' : ''})`)
						}
					}
					if (hookEnabled('post:edit:format', 'strict')) {
						await formatFile(resolvePath(filePath))
					}
					if (hookEnabled('post:edit:typecheck', 'strict') && event.tool === 'edit' && /\.tsx?$/.test(filePath)) {
						await typecheck()
					}
				}
			}),
		)

		// --- Shell hook: env injection + command reminders -----------------------
		await track(
			ctx.shell.hook('create.before', (event) => {
				const env = buildShellEnv()
				for (const [key, value] of Object.entries(env)) event.env[key] = value

				if (hookEnabled('pre:bash:git-push-reminder', 'strict') && /\bgit push\b/.test(event.command)) {
					log('info', 'Remember to review changes before pushing: git diff origin/main...HEAD')
				}
				if (hookEnabled('pre:bash:tmux-reminder', 'strict') && LONG_RUNNING_RE.test(event.command)) {
					log('info', 'Long-running command detected - consider using background execution')
				}
				if (hookEnabled('post:bash:pr-created', ['standard', 'strict']) && event.command.includes('gh pr create')) {
					log('info', 'PR command executing - check GitHub Actions status once it completes')
				}
			}),
		)

		// --- Permission hook: auto-approve safe operations -----------------------
		await track(
			ctx.permission.hook('evaluate', (event) => {
				if (event.effect !== 'ask') return

				const action = event.action
				const resources = event.resources.join(' ')
				log('info', `Permission requested: ${action}${resources ? ` (${resources})` : ''}`)

				if (READ_ONLY_TOOLS.has(action)) {
					event.effect = 'allow'
					return
				}

				if (FORMATTER_RE.test(resources) || TEST_RE.test(resources)) {
					event.effect = 'allow'
				}
			}),
		)

		// --- Compaction hook: re-inject ECC context ------------------------------
		await track(
			ctx.session.hook('compaction', (event) => {
				if (!hookEnabled('session:compaction-context', ALL_PROFILES)) return
				event.system.push({ type: 'text', text: buildCompactionContext() })
			}),
		)

		// --- Tool registration: changed-files -------------------------------------
		await track(
			ctx.tool.transform((editor) => {
				editor.add(changedFilesTool)
			}),
		)

		// --- Event stream: filesystem + session lifecycle -------------------------
		const controller = new AbortController()

		async function handleEvent(ev: { type: string; [key: string]: unknown }): Promise<void> {
			if (ev.type === 'filesystem.changed') {
				const data = ev.data as { file: string; event: 'add' | 'change' | 'unlink' }
				const dir = (ev.location as { directory?: string } | undefined)?.directory
				if (!isForThisWorktree(dir)) return
				const changeType = data.event === 'add' ? 'added' : data.event === 'unlink' ? 'deleted' : 'modified'
				recordChange(data.file, changeType)
				if (changeType !== 'deleted' && /\.(ts|tsx|js|jsx)$/.test(data.file)) editedFiles.add(data.file)
				return
			}

			if (ev.type === 'session.created') {
				const data = ev.data as { location?: { directory?: string } }
				const dir = (ev.location as { directory?: string } | undefined)?.directory ?? data.location?.directory
				if (!isForThisWorktree(dir)) return
				if (!hookEnabled('session:start', ALL_PROFILES)) return
				log('info', `Session started - profile=${currentProfile}`)
				if (hasProjectFile('CLAUDE.md')) log('info', 'Found CLAUDE.md - project context present')
				return
			}

			if (ev.type === 'session.idle') {
				const dir = (ev.location as { directory?: string } | undefined)?.directory
				if (!isForThisWorktree(dir)) return
				auditConsoleLogs()
				return
			}

			if (ev.type === 'session.deleted') {
				const dir = (ev.location as { directory?: string } | undefined)?.directory
				if (!isForThisWorktree(dir)) return
				if (!hookEnabled('session:end-marker', ALL_PROFILES)) return
				log('info', 'Session ended - cleaning up')
				editedFiles.clear()
				clearChanges()
				pendingToolChanges.clear()
			}
		}

		const eventLoop = (async () => {
			try {
				for await (const ev of ctx.event.subscribe({ signal: controller.signal })) {
					try {
						await handleEvent(ev as { type: string; [key: string]: unknown })
					} catch (err) {
						log('error', `event handler failed for ${ev.type}: ${errorMessage(err)}`)
					}
				}
			} catch (err) {
				if (!controller.signal.aborted) log('error', `event stream closed: ${errorMessage(err)}`)
			}
		})()

		log('debug', `plugin loaded (profile=${currentProfile}, dir=${worktreePath})`)

		return async () => {
			controller.abort()
			await eventLoop
			for (const dispose of disposers) {
				try {
					await dispose()
				} catch {
					/* best-effort cleanup */
				}
			}
			log('debug', 'plugin cleanup complete')
		}
	},
})
