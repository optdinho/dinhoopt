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

### Blocked

- None

### Next Steps

1. Fase 5: Dívida Técnica — steam libs dinâmicas
2. Renderer hooks (7 files) remain blocked — require jsdom environment

## Session Summary (2026-06-20)

### Done

- **cli.test.ts**: Expanded from 65 to 89 tests covering 4 previously untested handlers:
  - `handleCve`: list (text/json), no subcommand → usage (3 tests)
  - `handleHistory`: list (text/json), clear, unknown subcommand (4 tests)
  - `handleConfig`: get all (text/json), get key (text/json), dotted path, nonexistent key, set string/number/bool, set without args, unknown subcommand (14 tests)
  - `handlePerf`: info (text/json), disk-health (text/json), kill, unknown subcommand, no subcommand (7 tests)
  - Unknown top-level command (1 test)
  - **28 new tests** — all passing, no regressions
  - New `vi.mock` calls: `perf-monitor`, `history-store`, `settings-store` (constructor uses `function()` not arrow per vitest 4.x requirement)

- **Coverage results**: cli.ts from **1.78%** → handlers now tested. 4592 tests, 161 files — 0 quebras.

- **ipc-validation.test.ts**: Expanded from 103 to **140 tests** (+37) covering previously uncovered validation branches:
  - `validateSettingsPartial`: 27 new tests — path traversal exclusions, UNC exclusions, ignoredSoftwareUpdates limits, schedule/schedules validations (null/primitive/field-level), cleaner non-object + closeBrowsersBeforeClean, registryIgnoredTweak max length, gameMode non-boolean autoDetect/autoDeactivate
  - `validateHistoryEntry`: 10 new tests — array input, non-string timestamp, overly long timestamp, non-number fields (duration/itemsFound/itemsCleaned/itemsSkipped/spaceSaved/errorCount), all remaining valid type values
  - **37 new tests** — all passing, no regressions

- **Coverage results**: Overall: Statements **77.72%** (+0.17%), Branches **66.11%** (+0.33%), Functions **84.86%** (unchanged), Lines **79.76%** (unchanged). **4638 tests**, 161 files — 0 quebras.

- **loader.test.ts**: Added 1 test for array `dbFiles` branch (previously only string `dbFiles` tested). **14 tests** total.
- **game-detector.test.ts**: Added 3 tests covering `pollRunning` re-entrant guard, `game === suppressedGame` early return, and malformed CSV line handling. **23 tests** total.
- **yara-rules-store.test.ts**: Fixed no-op test (now actually calls `stopPeriodicRuleChecks` twice), added 2 `getRulesMetadata` tests (array JSON, string JSON), added 3 `fetchAndCacheRules` bundle validation tests (oversized version/updatedAt/sha256). **73 tests** total.
- **store-base.test.ts**: Added 1 test for `isPackaged === true` branch, migrated electron mock to getter for runtime mutation. **10 tests** total.

## Session Summary (2026-06-20b)

### Done

- **Fase 5 — Unificar Loggers**: Migrated all 3 usages of `logger.ts` (Logger B — sync, plain text) to `logger.service.ts` (Logger A — async, JSONL):
  - `scheduler.ts`: `logInfo(...)` → `getLogger().info('Scheduler', ...)` (7 calls)
  - `renderer-diagnostics.ts`: `logError/logInfo(...)` → `getLogger().error/info('RendererDiagnostics', ...)` (8 calls, incl. preload-error with Error→string conversion)
  - `daemon.ts`: removed `setDaemonMode(true)` import (daemon uses own `log()` for stdout)
  - Test mocks migrated: `scheduler.test.ts` + `renderer-diagnostics.test.ts` switched from `'./logger'` to `'./logger.service'` with `getLogger()` mock
  - `daemon.test.ts`: removed `setDaemonMode` mock and assertion
  - **Deleted** `src/main/services/logger.ts` (92L) and `src/main/services/logger.test.ts` (84L) — no remaining imports
  - Result: all logs now go through the unified async JSONL logger, visible in app's log viewer
  - **4631 testes**, 160 arquivos — 0 quebras

## Session Summary (2026-06-20c)

### Done

- **Fase 5 — MAX_CACHE_SIZE configurável**: `scan-cache.ts`:
  - Replaced `const MAX_CACHE_SIZE = 200_000` with mutable `let _maxCacheSize`
  - Added `setMaxCacheSize(n: number)` (exported, clamped to min 1)
  - `cacheItems()` now reads from `_maxCacheSize` (via local `limit`)
  - All 11 existing call sites unchanged — 100% backward compatible
  - 3 new tests: reduces limit, clamps 0→1, clamps negative→1
  - **4634 testes**, 160 arquivos — 0 quebras

## Session Summary (2026-06-20d)

### Done

- **Fase 5 — steam libs dinâmicas**: `gaming-cleaner.ipc.ts`:
  - Added `detectSteamFromRegistry()` helper querying `HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath` via `reg.exe`
  - `getSteamLibraryPaths()` tries registry first, falls back to hardcoded `steamLibraries()` from `steam.json`
  - Uses existing `execNativeUtf8` from `exec-utf8.ts` (already whitelisted `reg.exe`)
  - 2 new tests: registry-based VDF discovery, fallback when registry fails
  - **4636 testes**, 160 arquivos — 0 quebras

- **Renderer hooks (7 files) desbloqueados**:
  - Installed `jsdom` + `@testing-library/react` as devDependencies
  - Added `jsdom` environment via `// @vitest-environment jsdom` pragma on each test file
  - Updated `vitest.config.ts` include pattern to support `*.test.tsx`
  - **45 tests** across 7 hook files:
    | File | Tests |
    |---|---|
    | `useAnimatedCounter.test.tsx` | 4 |
    | `useProgressListener.test.ts` | 3 |
    | `usePlatform.test.tsx` | 4 |
    | `useIpcAction.test.tsx` | 9 |
    | `useIpcScan.test.tsx` | 8 |
    | `useBackgroundScans.test.tsx` | 7 |
    | `useScheduledScan.test.tsx` | 8 |
  - Store mocks via `vi.mock` for zustand stores (updater-store, driver-store, scan-store, history-store, settings-store)
  - `window.dinho` mock with key IPC methods
  - All `console.error` side-effects (IPC scan/action failures) intentionally left unmocked (tested error paths)
  - **4681 testes**, 167 arquivos — 0 quebras (threads pool crash on Windows, forks pool passes clean)

## Session Summary (2026-06-20e)

### Done

- **file-shredder.ipc.test.ts**: +5 tests covering previously uncovered branches:
  - `getEntrySize` top-level symlink → returns 0 (previously `undefined`)
  - `getEntrySize` lstat error → catch block hit with 0 size
  - non-Error exception during shred → catch handles string rejection
  - in-loop progress with `totalBytes = 0` → timing guard prevents NaN from division by zero
  - USERPROFILE fallback when HOME is unset → correct folder resolution
  - **55 tests** total (was 50, +5)
  - 2 pre-existing `noExplicitAny` lint errors remain in older tests (not introduced)

- **Deleted `src/main/services/registry-cleaner/`** subdirectory (dead code, zero importers):
  - `benchmark.ts` (606L), `compliance-auditor.ts` (654L), `gaming-cleaner.ts` (446L), `malware-scanner.ts` (1154L), `performance.ts` (1781L)
  - All unused — `registry-cleaner.service.ts` and `registry-cleaner.ipc.ts` remain intact
  - ~5KB dead code removed

## Session Summary (2026-06-20f)

### Done

- **Import bug fix**: `ScannerPanel.tsx` importava `canAllowlistThreat` de `scanner-panel-constants` mas a função estava em `scanner-panel-utils` — corrigido separando os imports

- **Removed 7 `console.warn` from production code**:
  - `malware-scanner.service.ts` (3): Rule load warnings, no rules loaded, init failed
  - `yara-engine.ts` (4): Init failed, bulk compile failed, scan error, file scan error
  - All replaced with `getLogger().warning('yara', ...)`
  - Test mock (`yara-engine.test.ts`) updated with `warning: vi.fn()`

- **Integrated dead UI components**:
  - `ThreatIntelPanel` and `CloudBackupPanel` existed but were never imported
  - Added to barrel `index.ts`, added 2 new tabs in `MalwareScannerPage.tsx`
  - Added translation keys (`tabIntel`, `tabBackup`) in en/pt/es locales
  - Backend (services, IPC, store) was already fully implemented

- **Final suite**: **4797 tests**, 171 files — 0 quebras
