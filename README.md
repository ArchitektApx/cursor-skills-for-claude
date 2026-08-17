<div align="center">

# 🧰 cursor-skills-for-claude

**Cursor's official agent skills, packaged for Claude Code and every other agent.**

[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Upstream](https://img.shields.io/badge/upstream-cursor%2Fplugins-black?style=flat-square&logo=github)](https://github.com/cursor/plugins)
[![Sync](https://img.shields.io/github/actions/workflow/status/ArchitektApx/cursor-skills-for-claude/sync.yml?style=flat-square&label=sync)](https://github.com/ArchitektApx/cursor-skills-for-claude/actions/workflows/sync.yml)
[![Auto-synced](https://img.shields.io/badge/auto--synced-daily-brightgreen?style=flat-square)](./CLAUDE.md)

</div>

> [!NOTE]
> Everything here is generated from [cursor/plugins](https://github.com/cursor/plugins)
> via automated workflows. All credit for the skills goes to the Cursor team.

---

## 🚀 Install

### Claude Code

```
/plugin marketplace add ArchitektApx/cursor-skills-for-claude
/plugin install cursor-team-kit@cursor-skills-for-claude
/plugin install thermos@cursor-skills-for-claude
```

### Everything else

```
npx skills@latest add ArchitektApx/cursor-skills-for-claude
```

Installs the `cursor-team-kit` skills into every agent it detects. `thermos` is
Claude Code only, since it runs as subagents and `npx skills` installs skills
only.

---

## 🛠️ Skills

<!-- skills:start -->

### `cursor-team-kit` · 18 skills · 2 subagents

| Skill | Description |
| :--- | :--- |
| `loop-on-ci` | Watch CI runs and iterate on failures until checks pass |
| `review-and-ship` | Run a structured review, commit changes, and open a PR |
| `pr-review-canvas` | Generate an interactive HTML PR walkthrough with annotated, categorized diffs |
| `verify-this` | Prove or disprove claims with baseline/treatment artifacts and a clear verdict |
| `control-cli` | Build or adapt a local harness to drive and profile interactive CLIs or TUIs |
| `control-ui` | Build or adapt a local browser/CDP harness for web or Electron UIs |
| `make-pr-easy-to-review` | Clean noisy PR history, improve descriptions, and add reviewer guidance |
| `run-smoke-tests` | Run Playwright smoke tests and triage failures |
| `fix-ci` | Find failing CI jobs, inspect logs, and apply focused fixes |
| `new-branch-and-pr` | Create a fresh branch, complete work, and open a pull request |
| `get-pr-comments` | Fetch and summarize review comments from the active pull request |
| `check-compiler-errors` | Run compile and type-check commands and report failures |
| `what-did-i-get-done` | Summarize authored commits over a given time period into a concise status update |
| `weekly-review` | Generate a weekly recap of shipped work with bugfix/tech-debt/net-new highlights |
| `fix-merge-conflicts` | Resolve merge conflicts, validate build/tests, and summarize decisions |
| `deslop` | Remove AI-generated code slop and clean up code style |
| `workflow-from-chats` | Extract durable working preferences from chats into skills, rules, or docs |
| `thermo-nuclear-code-quality-review` | Run an unusually strict maintainability review (code-judo, 1k-line rule, spaghetti, boundaries) |

### `thermos` · 3 skills · 2 subagents

| Skill | Description |
| :--- | :--- |
| `thermo-nuclear-review` | Deep branch audit (bugs, breakages, security, devex, feature-gate leaks) |
| `thermo-nuclear-code-quality-review` | Strict maintainability audit (code-judo, 1k-line rule, spaghetti, boundaries) |
| `thermos` | Run both review subagents in parallel and synthesize findings |

<!-- skills:end -->

> [!TIP]
> `thermo-nuclear-code-quality-review` ships in both plugins because it is in
> both upstream plugins. Claude Code namespaces them per plugin.

---

## 🔀 Changes from upstream

Skill content is copied verbatim, with two exceptions:

| What | Why |
| :--- | :--- |
| `workflow-from-chats` says "recent agent chats", not "recent Cursor chats" | The skill works against any agent's transcripts |
| `ci-watcher` uses `model: haiku` instead of `model: fast`, and drops `is_background` | Cursor-only frontmatter values |

Upstream `rules/`, `hooks/`, `automations/` and `mcp.json` are not packaged. No
skill here references them.

---

## 📄 License

Skill content is copyright © 2026 Cursor, MIT licensed. See [`NOTICE`](./NOTICE).

Not affiliated with or endorsed by Cursor.
