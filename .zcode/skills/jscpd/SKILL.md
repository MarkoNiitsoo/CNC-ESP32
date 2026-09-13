---
name: jscpd
description: Fast native Rust clone of jscpd. Detect duplicated code and measure duplication percentages.
---

# jscpd-rs

Fast native Rust clone of jscpd. Use this skill to run `jscpd-rs` and
understand its output.

## Quick Start

```bash
# Run with ai reporter (compact output optimized for agents)
npx jscpd-rs --reporters ai <path>

# With ignore patterns
npx jscpd-rs --reporters ai --ignore "**/node_modules/**,**/dist/**" <path>

# Scope to specific formats
npx jscpd-rs --reporters ai --format "javascript,typescript" <path>
```

## AI Reporter Output Format

The `ai` reporter produces compact, token-efficient output designed for agent
consumption:

```text
Clones:
src/ foo.ts:10-25 ~ bar.ts:42-57
src/utils/helpers.ts:100-120 ~ src/utils/other.ts:5-25
---
3 clones · 4.2% duplication
```

Each line represents one clone pair:

- Same file: `path/file.ts 10-25 ~ 45-60`
- Same directory: `shared/prefix/ file-a.ts:10-25 ~ file-b.ts:42-57`
- Different paths: `path/a.ts:10-25 ~ path/b.ts:42-57`

## Options

| Option | Description |
| --- | --- |
| `--reporters ai` | Use the AI-optimized reporter |
| `--reporters html` | Generate HTML report |
| `--reporters json` | Output JSON report |
| `--min-tokens N` | Minimum tokens to consider a duplication |
| `--min-lines N` | Minimum lines to consider a duplication |
| `--threshold N` | Exit with error if duplication percentage exceeds N |
| `--ignore "glob"` | Ignore patterns, comma-separated |
| `--format "list"` | Limit to specific languages |
| `--pattern "glob"` | Glob pattern to select files |
| `--gitignore` | Respect `.gitignore` |
| `--output "path"` | Directory to write reports to |
| `--silent` | Suppress output |
| `--no-tips` | Disable terminal tips |
| `--config "path"` | Path to `.jscpd.json` config file |

## Configuration File

Create a `.jscpd.json` in your project root:

```json
{
  "threshold": 0,
  "reporters": ["ai"],
  "ignore": ["**/node_modules/**", "**/dist/**", "**/*.min.*"],
  "format": ["typescript", "javascript"],
  "minLines": 5,
  "minTokens": 50,
  "output": "./reports/jscpd"
}
```

## Refactoring Duplicated Code

Once duplicates are detected, use the `dry-refactoring` skill for a guided
workflow to eliminate them:

```bash
npx skills add vv-bogdanov/jscpd-rs --skill dry-refactoring
```
