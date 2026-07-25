---
name: build-error-resolver
description: Use this skill when build fails or type/compilation errors occur. Fixes build/type errors with minimal diffs, no architectural edits. Adapted for DiNho Optimizer (TypeScript + C#).
origin: ECC
---

# Build Error Resolver

Expert build error resolution specialist for DiNho Optimizer. Fixes TypeScript and C# build/type errors quickly with minimal changes. No architectural modifications.

## When to Activate

- `npx electron-vite build` fails
- `npx tsc --noEmit` shows errors
- `dotnet build` fails for the C# engine
- Type errors blocking development
- Import/module resolution errors
- Configuration errors

## Do NOT Use When

- Code needs refactoring (use refactoring workflow)
- Architectural changes needed
- New features required (use tdd-workflow)
- Tests failing (use tdd-workflow)
- Security issues found (use security-review)

## Core Rules

### MINIMAL DIFFS ONLY
- Fix only the error, nothing else
- Don't refactor unrelated code
- Don't rename variables/functions (unless causing error)
- Don't add new features
- Don't change logic flow (unless fixing error)
- Target: <5% of affected file changed

## Diagnostic Commands

### TypeScript / Electron Vite
```bash
# Full build
npx electron-vite build 2>&1

# Type check only (no emit)
npx tsc --noEmit 2>&1 | head -50

# Check specific file
npx tsc --noEmit src/path/to/file.ts 2>&1
```

### C# / .NET Engine
```bash
# Full build
dotnet build dinho-clips-poc/src/DiNho.Capture.Poc/DiNho.Capture.Poc.csproj 2>&1

# Build with restore
dotnet build dinho-clips-poc/src/DiNho.Capture.Poc/DiNho.Capture.Poc.csproj --restore 2>&1

# Check specific project
dotnet build dinho-clips-poc/src/DiNho.Capture.Poc/DiNho.Capture.Poc.csproj --no-restore 2>&1 | head -30
```

### Lint
```bash
npm run lint 2>&1 | head -40

# Auto-fix
npm run lint -- --fix 2>&1
```

## Error Resolution Workflow

### 1. Collect ALL Errors
```
a) Run full type/build check — capture ALL errors, not just first
b) Categorize by type:
   - TypeScript type errors
   - C# compilation errors
   - Import/export errors
   - Configuration errors
   - Dependency issues
   - Vite/Rollup bundling errors
c) Prioritize:
   - Blocking build → Fix first
   - Type errors → Fix in order
   - Warnings → Fix if time permits
```

### 2. Fix Strategy
```
For each error:
1. Read error message carefully (file, line, expected vs actual)
2. Find minimal fix (add type, fix import, add null check)
3. Verify fix doesn't break other code (recompile after each fix)
4. Iterate until build passes
```

### 3. Common Error Patterns (TypeScript)

**Implicit any:**
```typescript
// ❌ Parameter 'x' implicitly has an 'any' type
function add(x, y) { return x + y }
// ✅ FIX:
function add(x: number, y: number): number { return x + y }
```

**Object possibly undefined:**
```typescript
// ❌ Object is possibly 'undefined'
const name = user.name.toUpperCase()
// ✅ FIX:
const name = user?.name?.toUpperCase()
```

**Missing property:**
```typescript
// ❌ Property 'age' does not exist on type 'User'
// ✅ FIX: Add property to interface or use type assertion
```

**Import error:**
```typescript
// ❌ Cannot find module '@/lib/utils'
// ✅ FIX: Check tsconfig paths, use relative import, or install package
```

**React Hook rules:**
```typescript
// ❌ React Hook "useState" cannot be called conditionally
// ✅ FIX: Move hooks to top level
```

### 4. Common Error Patterns (C#)

**CS0246 - Type not found:**
```csharp
// ❌ The type or namespace name 'X' could not be found
// ✅ FIX: Add using directive or NuGet package
```

**CS0117 - Member does not exist:**
```csharp
// ❌ 'Type' does not contain a definition for 'Member'
// ✅ FIX: Check API changes after upgrade (e.g., Vortice int→uint)
```

**CS0029 - Type conversion:**
```csharp
// ❌ Cannot implicitly convert type 'uint' to 'int'
// ✅ FIX: Add explicit cast (int)value or change variable type
```

**CS8600/CS8602/CS8603 - Nullable warnings:**
```csharp
// ✅ FIX: Add null check, use ?? operator, or use ! (null-forgiving)
```

**Vortice upgrade (int↔uint):**
```csharp
// After Vortice 3.5→3.8 upgrade, many APIs changed int→uint
// ✅ FIX: Cast explicitly: (int)enumValue or (uint)intValue
```

## Build Error Report Format

```markdown
# Build Error Resolution Report

**Date:** YYYY-MM-DD
**Build Target:** electron-vite / tsc / dotnet build
**Initial Errors:** X
**Errors Fixed:** Y
**Build Status:** [PASS/FAIL]

## Errors Fixed

### 1. [Error Category]
**Location:** `file.ts:45` or `File.cs:45`
**Error:** <error message>
**Fix:** <what changed>
**Lines Changed:** N

## Verification
1. [ ] Build passes: `npx electron-vite build`
2. [ ] C# builds: `dotnet build`
3. [ ] No new errors introduced
4. [ ] Tests still passing
```

## Quick Reference

```bash
# TypeScript full check
npx tsc --noEmit

# Electron Vite build
npx electron-vite build

# C# build
dotnet build dinho-clips-poc/src/DiNho.Capture.Poc/DiNho.Capture.Poc.csproj

# Lint auto-fix
npm run lint -- --fix

# Clear cache and rebuild
Remove-Item -Recurse -Force node_modules/.vite
npx electron-vite build
```

## Success Metrics

After resolution:
- [ ] `npx electron-vite build` exits 0
- [ ] `npx tsc --noEmit` exits 0
- [ ] `dotnet build` exits 0
- [ ] No new errors introduced
- [ ] Minimal lines changed (<5% of affected file)
- [ ] Tests still passing
