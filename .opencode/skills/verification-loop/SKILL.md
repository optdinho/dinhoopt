---
name: verification-loop
description: Use this skill after completing features, before PRs, or after refactoring. Runs comprehensive build, type, lint, test, and security verification to ensure quality gates pass. Adapted for DiNho Optimizer (Electron + TypeScript + C#).
origin: ECC
---

# Verification Loop Skill

Comprehensive verification system for DiNho Optimizer sessions.

## When to Activate

- After completing a feature or significant code change
- Before creating a PR/commit
- When quality gates need validation
- After refactoring or large-scale changes
- When the user asks "verify" or "check everything"

## Verification Phases

### Phase 1: Build Verification (TypeScript)

```bash
npx electron-vite build 2>&1 | tail -20
```

If build fails, STOP and fix before continuing.

### Phase 2: Build Verification (C# Engine)

```bash
dotnet build dinho-clips-poc/src/DiNho.Capture.Poc/DiNho.Capture.Poc.csproj --no-restore 2>&1 | tail -20
```

If C# build fails, STOP and fix before continuing. Report warnings count.

### Phase 3: Type Check (TypeScript)

```bash
npx tsc --noEmit 2>&1 | head -30
```

Report all type errors. Fix critical ones before continuing.

### Phase 4: Lint Check

```bash
npm run lint 2>&1 | head -40
```

Report error count and categories. Target: 0 errors.

### Phase 5: Test Suite (TypeScript)

```bash
npx vitest run 2>&1 | tail -50
```

Report:
- Total tests: X
- Passed: X
- Failed: X
- Files: X

### Phase 6: Test Suite (C#)

```bash
dotnet test dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ --no-restore 2>&1 | tail -30
```

Report:
- Total tests: X
- Passed: X
- Failed: X

### Phase 7: Security Scan

```bash
# Check for hardcoded secrets
rg "sk-|api_key|password|token" --type ts --type cs -g '!*.test.*' -g '!*.spec.*' -g '!node_modules' -g '!dist' . 2>/dev/null | head -10

# Check for console.log in production code
rg "console\.log" --type ts -g '!*.test.*' -g '!*.spec.*' -g '!node_modules' src/main/ 2>/dev/null | head -10
```

### Phase 8: Diff Review

```bash
git diff --stat
git diff HEAD~1 --name-only
```

Review each changed file for:
- Unintended changes
- Missing error handling
- Potential edge cases
- Security concerns

## Output Format

After running all phases, produce a verification report:

```
VERIFICATION REPORT
==================

Build (TS):    [PASS/FAIL]
Build (C#):    [PASS/FAIL] (N warnings)
Types:         [PASS/FAIL] (X errors)
Lint:          [PASS/FAIL] (X errors)
Tests (TS):    [PASS/FAIL] (X/Y passed)
Tests (C#):    [PASS/FAIL] (X/Y passed)
Security:      [PASS/FAIL] (X issues)
Diff:          [X files changed]

Overall:       [READY / NOT READY] for commit

Issues to Fix:
1. ...
2. ...
```

## Continuous Mode

For long sessions, run verification every 15 minutes or after major changes:

- After completing each function
- After finishing a component
- Before moving to next task

## Integration with Other Skills

This skill complements the `tdd-workflow` and `security-review` skills:
- `tdd-workflow` ensures tests are written before code
- `security-review` catches security issues during development
- `verification-loop` validates everything works together as a final gate
