# DiNho Optimizer — Agent Instructions

## Project Overview

DiNho Optimizer is an Electron desktop application for Windows system optimization, built with TypeScript, React, and Electron Vite. It provides system cleaning, registry optimization, malware scanning, privacy protection, driver management, and more.

## Tech Stack

- **Runtime:** Electron (main + renderer process)
- **Language:** TypeScript (strict mode)
- **UI:** React + Tailwind CSS + shadcn/ui
- **Build:** Electron Vite
- **State:** Zustand
- **Testing:** Vitest + Playwright (E2E)
- **Package Manager:** npm

## Core Principles

1. **Test-Driven** — Write tests before implementation, 80%+ coverage required
2. **Security-First** — Validate all inputs, sanitize paths, never mutate
3. **Immutability** — Create new objects, never mutate existing state
4. **Agent-First** — Delegate complex tasks to specialized agents
5. **Plan Before Execute** — Plan complex features before writing code

## Agent Orchestration

Use agents proactively without explicit user prompt:
- Complex feature requests → **planner**
- Code just written/modified → **code-reviewer**
- Bug fix or new feature → **tdd-guide**
- Architectural decision → **architect**
- Security-sensitive code → **security-reviewer**
- Build/type errors → **build-error-resolver**
- E2E critical flows → **e2e-runner**

Use parallel execution for independent operations.

## Security Guidelines

**Before ANY commit:**
- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitized HTML)
- CSRF protection enabled
- Error messages don't leak sensitive data

**If security issue found:** STOP → use security-reviewer agent → fix CRITICAL issues

## Coding Style

- Many small files over few large ones (200–400 lines typical, 800 max)
- Functions small (<50 lines), files focused (<800 lines)
- No deep nesting (>4 levels)
- Proper error handling — never silently swallow errors
- File organization by feature/domain, not by type

## Testing Requirements

**Minimum coverage: 80%**
- Unit tests — individual functions, utilities
- Integration tests — IPC handlers, stores
- E2E tests — critical user flows

## Git Workflow

Commit format: `<type>: <description>` — Types: feat, fix, refactor, docs, test, chore, perf

## Lint Status (2026-06-13)

- `noExplicitAny`: **error** (enabled Jun 13, 2026) — all violations cleaned up:
  - 6 `catch (err: any)` → `catch (err: unknown)` in production IPC handlers
  - 1 `app.on(... as any)` → `as never` in `src/main/index.ts`
  - All test file instances suppressed via `// biome-ignore lint/suspicious/noExplicitAny`
- `noConsoleLog`: **error** — all violations in main process replaced with `getLogger()`
- Pre-existing: 476 lint errors remain (primarily `noBannedTypes`/`Function` in test files)

## Session Summary (2026-06-15)

### Done

- **malware-store.test.ts**: Expanded from 17 to 78 tests covering all store methods:
  - Core state: `setThreats`, `setSelectedIds`, `setStatus`, `setActionMode`, `setExpandedId`, `toggleItem`, `selectAll`, `reset`, `removeThreat`
  - Quarantine: `setQuarantineItems`, `setQuarantineSelectedIds`, `setQuarantineStatus`, `toggleQuarantineItem`, `selectAllQuarantine`
  - Allowlist: `setAllowlist`, `setAllowlistStatus`
  - Custom YARA rules: `loadCustomRules`, `addCustomRule`, `removeCustomRule` (success/error/falsy return)
  - Scan profiles: `setProfile`, `loadProfiles`
  - File watcher: `startWatcher`, `stopWatcher`
  - Memory scanner: `runMemoryScan`, `setMemoryResult`, `setIsMemoryScanning`
  - Threat timeline: `loadTimeline`, `clearTimelineStore`, `setTimeline`, `setTimelineStats`
  - Threat intel: `loadIntelStats`, `checkIntelHash`, `toggleFeed`, `clearIntel`
  - Exploit detection: `setExploitEnabled`
  - Cloud backup: `loadBackupConfig`, `setBackupConfig`, `runBackup`, `restoreBackupItem`
  - Behavioral sandbox: `runSandbox`
  - All async error handlers covered (try/catch silent-fail patterns)

## Session Summary (2026-06-18)

### Done

- **scheduler.test.ts**: Expanded from 39 to 54 tests covering previously uncovered branches in `isDueEntry`, `triggerScheduleEntry`, `notifyScheduledScanComplete`, and `completeScheduleRun`:
  - `isDueEntry` weekly paths: correct day/within window, wrong day, outside 2-min window, already run today
  - `isDueEntry` monthly paths: correct date/within window, wrong date, outside 2-min window, already run today, clamped day (31 on Feb 28)
  - `triggerScheduleEntry` notification creation when `Notification.isSupported() = true`
  - Safety timeout callback after 10-min `IN_FLIGHT_TIMEOUT_MS`
  - `notifyScheduledScanComplete` notification path with `showNotificationOnComplete = true`
  - `completeScheduleRun` in-flight timer cleanup

- **Coverage results**: `scheduler.ts` from 39.53% → **96.89%** statements, 60.71% → **91.66%** branches, **100%** functions, **99.09%** lines. Only uncovered line is `isDueEntry` line 90 (unreachable fallthrough `return false`).

- **Electron mock fix**: `vi.fn().mockImplementation(() => ({ show: vi.fn() }))` changed to `vi.fn(function() { return { show: vi.fn() } })` because vitest 4.x rejects arrow function implementations in constructor mocks with `TypeError: not a constructor`

### In Progress

- Coverage target for scheduler.ts (was 39.53% — now 96.89%)
- Coverage target for malware-store.ts (was 47.75% — now substantially higher with 78 tests)

### Blocked

- None

### Next Steps

1. Continue expanding coverage for other low-coverage files: cli.ts (1.78%), yara-rules-store.ts (74.18%), game-detector.ts (76.19%), loader.ts (76.59%), validation.ts (73.59%)
2. Add tests for remaining renderer stores
3. Renderer hooks (7 files) remain blocked — require jsdom environment
