---
name: brainstorming
description: "Design-before-code workflow for DiNho Optimizer: three exploration paths, mandatory approval gate, collaborative design. Use when the solution isn't obvious yet."
origin: project
date_added: "2026-08-18"
---

# Brainstorming

Design-first skill adapted from [obra/superpowers](https://github.com/obra/superpowers). Forces exploration and design before writing code. Prevents the "jump straight to implementation" trap.

## When to Activate

- Problem is ambiguous (multiple possible solutions, unclear trade-offs)
- User describes a goal but not the approach ("I want clips to have per-app audio")
- Bug with multiple possible root causes
- Feature requiring architectural decision (new dependency, new subsystem)
- User says "what do you think about..." or "how should we..."
- User says "brainstorm" or "design first"

## Do NOT Use When

- Solution is obvious and scoped (single-file fix, test addition)
- User explicitly says "just implement it"
- `writing-plans` is already producing a detailed plan (brainstorming happens BEFORE plans)
- Bug is clearly diagnosed with a known fix

## Three Exploration Paths

Choose one based on the problem's nature:

### Path 1: Spike (Technical Unknown)

**When:** Need to verify a technical approach works before committing.

```
1. Identify the specific unknown ("Can ffmpeg sr_amf upscale 720p→1080p realtime?")
2. Write minimal proof-of-concept (1-3 files, no tests needed)
3. Run it. Capture output.
4. Report: "Works / Doesn't work / Partial — here's why"
5. User decides: proceed, pivot, or abandon
```

**DiNho examples:**
- "Can WGC Session5 `IncludeSecondaryWindows` capture popup menus?"
- "Does ffmpeg 9.0 accept `-weighted_pred 1` with av1_nvenc?"
- "Can `MapFlags.DoNotWait` avoid GPU busy stalls?"

### Path 2: Bounded Design (Known Scope)

**When:** Know what to build, need to decide HOW.

```
1. Read the relevant code (grep + read, not guess)
2. List 2-3 viable approaches with trade-offs
3. Present to user with recommendation
4. User picks one
5. Create plan via `writing-plans` skill
6. Implement with TDD
```

**DiNho examples:**
- "How should disk spill work in ReplayBuffer?"
- "Should clips enhance use AMD AMF or ffmpeg filters?"
- "What's the right IPC pattern for RAM pressure broadcasts?"

### Path 3: Open-Ended Exploration (Big Picture)

**When:** Problem is vague or scope is large.

```
1. Ask clarifying questions (what, why, constraints)
2. Map the codebase area (glob + grep + read)
3. Identify 3-5 options (from minimal to ambitious)
4. Present options with effort/risk/impact
5. User narrows scope
6. Hand off to Path 2 or `writing-plans`
```

**DiNho examples:**
- "How should we reduce the engine's 2.5GB footprint?"
- "What's the best approach for multi-track audio?"
- "Should we add cloud backup for clips?"

## Mandatory Approval Gate

**NO CODE until the user approves the design.**

This is the most important rule. Brainstorming produces **options and recommendations**, not implementations.

### The Gate

After presenting the analysis, explicitly ask:

```
Here are the options:

A. [Approach] — Effort: X, Risk: Y, Impact: Z
B. [Approach] — Effort: X, Risk: Y, Impact: Z
C. [Approach] — Effort: X, Risk: Y, Impact: Z

My recommendation: [X] because [reason].

Which approach should I implement?
```

**Do NOT proceed with "I'll go with my recommendation"** — wait for user response.

### Exceptions to the Gate

- User already specified the approach in their request
- Single-file trivial fix with obvious solution
- Continuing a plan that was already approved earlier in the conversation

## Collaborative Design Principles

1. **Read code before assuming** — Use grep/glob/read. Don't guess what exists.
2. **Present trade-offs honestly** — Every approach has downsides. State them.
3. **Scope honestly** — "This is a 2-day feature" beats "I'll do it real quick."
4. **Kill bad ideas early** — If an approach won't work, say so before spending tokens.
5. **One decision at a time** — Don't dump 10 decisions on the user. Get approval, then move to the next.

## Brainstorm → Plan → Implement Flow

```
User request
    ↓
[brainstorming] Explore options, get approval
    ↓
[writing-plans] Create detailed execution plan
    ↓
Implementation (TDD, one step at a time)
    ↓
[verification-loop] Validate everything works
```

## Anti-Patterns

- **"Let me just start coding"** — Stop. Explore first. The solution might not be what you think.
- **"I'll assume approach X"** — Don't assume. Ask or present options.
- **"I implemented it, hope that's what you wanted"** — Approval gate exists for a reason.
- **"This is simple, no need to plan"** — If it touches 3+ files, it's not simple.
