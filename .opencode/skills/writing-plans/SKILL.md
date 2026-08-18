---
name: writing-plans
description: "Structured planning for DiNho Optimizer: zero-context assumption, file mapping, bite-sized TDD tasks, plan persistence. Use before multi-file features or refactors."
origin: project
date_added: "2026-08-18"
---

# Writing Plans

Structured planning skill adapted from [obra/superpowers](https://github.com/obra/superpowers). Creates detailed execution plans before code touches the codebase.

## When to Activate

- Feature touching 3+ files or multiple subsystems (main + renderer + preload)
- Refactoring a large module (splitting files, extracting services)
- Bug fix requiring understanding of cross-cutting concerns
- Migration (dependency upgrade, framework change)
- Any work where "I'll figure it out as I go" would waste tokens

## Do NOT Use When

- Single-file trivial fix (typo, one-liner)
- Routine test additions to existing test file
- `build-error-resolver` is handling a compile error
- User explicitly says "just do it" for a small scope

## Zero-Context Assumption

The plan must assume **zero context**. If the plan is the only input, the agent executing it must be able to finish the job. Every file, function, and line number must be explicit.

### What This Means in Practice

- Don't say "modify the encoder" — say "edit `FfmpegEncoder.cs:267` and change `BuildEncoderTuneArgs` signature to add 8th param `amfPreset`"
- Don't say "add validation" — say "in `ConfigManager.cs:300`, add clamp for `SharpnessStrength` in `ValidateAndFix`: `Math.Clamp(value, 0, 1)` with fallback `0`"
- Every step must be verifiable: "run `dotnet test --filter FfmpegEncoderTests` — expect 0 failures"

## Plan Structure

```
# Plan: [Title]

## Problem
What's broken/missing. One paragraph.

## File Map
Every file that will be touched, with what changes:

| File | Change | Lines |
|------|--------|-------|
| `path/to/file.ts` | Add new method | ~45-60 |
| `path/to/file.test.ts` | Add 3 tests | ~30-40 |

## Steps (TDD where possible)

### Step 1: RED — Write failing test
- **File**: `path/to/test.ts`
- **What**: Add test case `X_does_Y_when_Z`
- **Assert**: `expect(result).toBe('expected')`
- **Verify**: `npx vitest run path/to/test.ts` — 1 failure

### Step 2: GREEN — Minimal implementation
- **File**: `path/to/source.ts`
- **What**: Add function/fix that makes test pass
- **Verify**: `npx vitest run path/to/test.ts` — 0 failures

### Step 3: Full suite
- **Verify**: `npm test` — 0 new failures

[Repeat per feature unit]

## Risks
- What could go wrong
- Mitigation for each risk
```

## File Structure Mapping

Before writing the plan, **map the codebase** for the area being modified:

```
# File Map for [feature area]

src/main/ipc/
├── example.ipc.ts          ← handler lives here
├── example.ipc.test.ts     ← tests here
├── index.ts                ← registration (add channel here)
src/shared/
├── channels.ts             ← channel constant
├── types.ts                ← type definition
src/preload/
├── index.ts                ← preload bridge method
```

**How to map:**
1. `glob` for the target directory structure
2. `grep` for existing patterns (e.g., similar IPC handlers)
3. `read` the key files to understand conventions
4. Document what exists AND what needs to be added

## Bite-Sized Tasks

Each step in the plan must be **one atomic action** that:
1. Can be described in 1-3 sentences
2. Has a clear verify command
3. Takes < 5 minutes to execute
4. Produces a testable result

**Bad:** "Implement the entire clips enhance feature"
**Good:** "Add `EnhanceOption` type to `src/shared/types/clips.ts` with values `'none' | 'sr' | 'frc' | 'sr+frc'`"

## Scope Check

For multi-subsystem features, verify you've covered all layers:

- [ ] **Type definition** (shared/types or C# AppConfig)
- [ ] **Channel constant** (shared/channels.ts)
- [ ] **Main handler** (ipc/*.ipc.ts)
- [ ] **Preload bridge** (preload/index.ts)
- [ ] **Renderer call** (pages or components)
- [ ] **Store/state** (if zustand store needed)
- [ ] **Locale keys** (en/pt/es)
- [ ] **Tests** (unit + integration)
- [ ] **C# side** (if engine involvement needed)

## Plan Persistence

Plans for non-trivial features are saved to `docs/plans/` for reference:

```
docs/plans/
├── clips-enhance.md
├── replay-buffer-disk-spill.md
└── gpu-pipeline-opt-b.md
```

Plans are **living documents** — update them as implementation reveals new details.

## Anti-Patterns

- **"I'll add tests later"** — Write tests first (TDD). The plan must include them.
- **"Modify everything in one step"** — Split into atomic steps, each with verify command.
- **"Assume the agent knows the codebase"** — Zero-context means every path is explicit.
- **"The plan is just an outline"** — A vague plan produces vague code. Be surgical.
