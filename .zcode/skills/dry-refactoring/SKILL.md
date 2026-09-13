---
name: dry-refactoring
description: Guided workflow to eliminate copy-paste duplication detected by jscpd-rs.
---

# dry-refactoring

Guided workflow to eliminate copy-paste duplication in source code. Use after
running `jscpd-rs` to detect clones.

## Prerequisites

First, run `jscpd-rs` to identify duplications:

```bash
npx jscpd-rs --reporters ai <path>
```

See the [jscpd-rs skill](../jscpd/SKILL.md) for option details.

## Workflow

1. Run `jscpd-rs` with `--reporters ai` on the target path.
2. Parse each clone line to identify the duplicated file and line ranges.
3. Read both code fragments from the source files.
4. Understand what the duplicated code does.
5. Design a refactoring: extract a shared function, class, module, constant, or
   base abstraction.
6. Apply the refactoring and update all call sites, not just the two reported
   locations.
7. Run tests for the touched area.
8. Re-run `jscpd-rs` to confirm the clone is gone or reduced.
9. Repeat for the highest-impact remaining clones.

## Refactoring Strategies

Extract function: use when the duplicate is a repeated logic block.

Extract module or utility: use when the duplicate spans files that can depend on
a shared helper.

Extract constant or config: use when the duplicate is repeated data,
configuration, selectors, strings, or magic values.

Template or base abstraction: use when the duplicate is structural and the
shared shape is stable.

## Guardrails

- Do not refactor unrelated behavior while removing duplication.
- Keep the extracted abstraction named after the domain concept, not the clone.
- Check all similar call sites, because one clone pair can represent a larger
  duplicated family.
- Keep test fixtures duplicated when the duplication is intentional and improves
  readability.
- Prefer small, reversible refactors over broad rewrites.

## Useful Commands

```bash
npx jscpd-rs --reporters ai --min-lines 10 <path>
npx jscpd-rs --reporters json --output /tmp/jscpd-report <path>
```
