# Maintaining this repository

This repository redistributes skills from
[cursor/plugins](https://github.com/cursor/plugins). No skill content is
authored here.

## Working in this repository

`main` is protected by a ruleset with no bypass, so nothing lands by pushing to
it. Branch, push the branch, open a PR, merge it yourself. To merge, a PR needs
the `verify` check green and squash as its merge method; it needs no approvals.

Every commit must be signed. Local commits inherit `commit.gpgsign`; the sync
job's commits are signed because `sign-commits: true` makes the action commit
through the GitHub API.

Repository policy also requires every action to be pinned to a full commit SHA.
A tag reference does not fail review, it fails the run.

Dependabot owns action versions and bumps all three in one grouped PR monthly.
Bumping a SHA by hand only creates a conflict with the next one.

A workflow file registers with GitHub only when a push modifies it. A workflow
added in a repository's first push stays invisible — absent from the Actions
list, and `workflow_dispatch` returns 404 — until some later commit touches the
file.

## Generated vs authored

**Authored** — `sync.config.json`, `scripts/`, `.github/`, `README.md` outside
its markers, this file, `NOTICE`.

**Generated**, rewritten from scratch on every sync — `plugins/`, `skills/`,
`.claude-plugin/marketplace.json`, `.sync-state.json`, `AGENTS.md`, and the
region of `README.md` between `<!-- skills:start -->` and `<!-- skills:end -->`.

`AGENTS.md` is a byte-identical copy of this file, so agents that read one or
the other get the same context. Edit this file; the sync produces the copy and
CI fails if the two diverge.

To change anything generated, change `sync.config.json` or `scripts/sync.mjs`
and re-run the sync. Skill and subagent counts belong to the generated README
region, so prose that states a count belongs there too.

## Two trees

```
plugins/<plugin>/skills/   canonical, what Claude Code installs
skills/<skill>/            flat mirror, what `npx skills` installs
```

Claude Code wants each plugin rooted in its own directory so `skills/` and
`agents/` auto-discover per plugin. The Vercel `skills` CLI only scans known
container directories, so it needs a root-level `skills/`. Hence two trees, both
written by the same generator in the same run, with CI asserting they stay
byte-identical.

Only plugins with `"mirror": true` reach the flat tree. Every plugin vendored
today mirrors. The flag exists for a plugin whose skills delegate to subagents:
`npx skills` installs skills only, so mirroring those would ship instructions
to spawn agents that were never delivered.

## What is deliberately not vendored

Upstream `thermos` is not packaged, and neither is the cursor-team-kit
`thermo-nuclear-code-quality-review.md` agent. Both agents open with "load the
`thermo-nuclear-*` skill" and fall back to a rougher inline rubric when they
cannot. In Claude Code they never can: the rubric skills carry
`disable-model-invocation: true`, which hides them from the Skill tool, and the
agents preload nothing. Installed as-is they always ran the fallback while
claiming the full audit. The rubric skills themselves are self-contained and
work as slash commands, so cursor-team-kit still ships
`thermo-nuclear-code-quality-review`. The agent sits in that plugin's `skip`
list; `thermos` is simply not in the config. Making the agents work would need a
Claude-specific `skills:` preload injected at sync time; do that before
allowlisting either again.

## Running a sync

```
node scripts/sync.mjs            regenerate from upstream
node scripts/sync.mjs --verify   offline checks, no network
```

`sync.yml` runs the first daily and opens a PR when output differs. `verify.yml`
runs the second on every push and pull request.

Most upstream commits touch nothing this repository vendors and move only
`.sync-state.json`, so the sync opens a PR only when generated content changed
or upstream grew a skill the allowlist does not cover. The state file then stays
on the last content sync, which widens the commit range the next report lists
and changes nothing else.

Every condition the script reports is a decision for a human: upstream content
changed in a way the config no longer describes. Fix the config, or accept the
upstream change deliberately. Keep the sync failing on anything it fails on
today.

The sync also reports every path in an upstream plugin directory the config does
not name, whether that is an unallowlisted skill, an unallowlisted agent, or a
new top-level file or directory. `assets/` and `rules/` are deliberately skipped
and stay unreported: nothing references the imagery, and Cursor `.mdc` rules have
no Claude Code equivalent. A reported path opens a PR on its own, even when
nothing vendored changed. To turn one down for good, list it under the plugin's
`skip` in `sync.config.json` with a `reason`; otherwise the report, and the PR,
return on every run. A `skip` whose path vanished upstream fails the sync, since
the decision it records has nothing left to apply to.

## Invariants

Preserve these through any refactor of `.github/workflows/`:

- **Actions pinned to commit SHAs**, enforced by repository policy rather than
  convention. `create-pull-request` holds `contents: write`; a moved tag is a
  write path into this repository.
- **PR body passed as `body-path`.** It embeds upstream commit subjects. Routed
  through `GITHUB_OUTPUT`, a subject matching the heredoc delimiter lets
  upstream write arbitrary step outputs.
- **`verify.yml` triggers on `pull_request`.** It runs PR-head code, so
  `pull_request_target` would hand fork PRs write access and secrets.
- **Symlinks and executables refused at copy time.** Upstream chooses what sits
  in a skill directory, and whatever lands here is redistributed to everyone who
  installs the marketplace.
- **Upstream README text escaped before entering `README.md`.** A description
  containing a catalog marker would otherwise hijack the generated region on the
  next run.

## Gotchas

- `disable-model-invocation` is valid Claude Code frontmatter. Leave it in place.
- Only one plugin may mirror a given skill name. The CLI installs flat by
  frontmatter `name`, so a second one clobbers the first.
- `rewrites` run before mirroring, so the flat copy inherits them. Each rule
  breaks when upstream rewords its line, so keep the set small.
- Sync PR commits are signed only because `sign-commits: true` runs on the
  default `GITHUB_TOKEN`. Swapping in a PAT keeps the PR working and drops the
  signature without warning.
