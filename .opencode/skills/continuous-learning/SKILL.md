---
name: continuous-learning
description: Automatically extract reusable patterns from coding sessions and save them as learned knowledge. Detects error resolutions, user corrections, workarounds, and project-specific conventions.
origin: ECC
---

# Continuous Learning Skill

Evaluates coding sessions to extract reusable patterns that improve future work.

## When to Activate

- At the end of a long coding session
- When a complex bug was resolved
- When the user corrects a repeated mistake
- When a non-obvious workaround was discovered
- When the user says "learn this" or "remember this"

## Pattern Types to Detect

| Pattern | Description | Example |
|---------|-------------|---------|
| `error_resolution` | How specific errors were resolved | VRTX device lost → recreate D3D11 device chain |
| `user_corrections` | Patterns from user corrections | "Don't use arrow functions in vi.fn() constructors" |
| `workarounds` | Solutions to framework quirks | vitest 4.x requires `function()` not `() =>` in constructor mocks |
| `debugging_techniques` | Effective debugging approaches | Named pipe status → Log.I per-field → hex dump → root cause |
| `project_specific` | DiNho-specific conventions | C# engine via pipe IPC, self-contained publish, copy-engine staging |

## Extraction Process

### Step 1: Identify Extractable Patterns

Look for:
- Errors that took >2 attempts to resolve
- Solutions that required domain-specific knowledge
- Workarounds for library/framework bugs
- Patterns that would help in future sessions
- Conventions established during the session

### Step 2: Format as Knowledge Entry

```markdown
## [Category] Pattern Title

**Context:** When does this apply?
**Problem:** What was the issue?
**Solution:** What was the fix?
**Verification:** How to confirm it works?

### Example
<code example>
```

### Step 3: Save to Session Notes

Append extracted patterns to the current session's notes (AGENTS.md session summary) or suggest additions to:
- `AGENTS.md` — session summaries with decisions and fixes
- `CLAUDE.md` — project conventions
- Relevant source code comments

## Pattern Templates

### Error Resolution
```markdown
## [Error Resolution] <Error Name>

**Symptom:** <what the error looks like>
**Root Cause:** <why it happens>
**Fix:** <exactly what to do>
**Files:** <affected files>
**Prevention:** <how to avoid it>
```

### User Correction
```markdown
## [User Correction] <Topic>

**Wrong approach:** <what was tried first>
**Correct approach:** <what the user wanted>
**Rule:** <generalized rule>
```

### Workaround
```markdown
## [Workaround] <Library/Framework> <Issue>

**Issue:** <bug or limitation>
**Workaround:** <the workaround>
**Upstream status:** <known issue / fixed in version X>
**Alternative:** <better solution if available>
```

### Project Convention
```markdown
## [Convention] <Topic>

**Pattern:** <established pattern>
**Rationale:** <why this way>
**Examples:** <file references>
```

## Integration

- Extracted patterns should be validated with the user before saving
- Prioritize patterns that apply to this specific project
- Cross-reference with existing AGENTS.md session summaries
- Avoid duplicating patterns already documented in AGENTS.md

## Anti-Patterns to Ignore

- Simple typos or one-time fixes
- External API outages
- Environment-specific issues (e.g., "my Node version was wrong")
- Trivial copy-paste errors
