# Maintaining this repository

This repository redistributes skills from
[cursor/plugins](https://github.com/cursor/plugins). No skill content is
authored here.

## Generated vs authored

**Authored** — `sync.config.json`, `scripts/`, `.github/`, `README.md` outside
its markers, this file, `NOTICE`.

**Generated**, rewritten from scratch on every sync — `plugins/`, `skills/`,
`.claude-plugin/marketplace.json`, `.sync-state.json`, and the region of
`README.md` between `<!-- skills:start -->` and `<!-- skills:end -->`.

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

Only plugins with `"mirror": true` reach the flat tree. `thermos` is excluded
because its skills delegate to subagents, and `npx skills` installs skills only.
Mirroring them would ship instructions to spawn agents that were never
delivered.

## Running a sync

```
node scripts/sync.mjs            regenerate from upstream
node scripts/sync.mjs --verify   offline checks, no network
```

`sync.yml` runs the first daily and opens a PR when output differs. `verify.yml`
runs the second on every push and pull request.

Every condition the script reports is a decision for a human: upstream content
changed in a way the config no longer describes. Fix the config, or accept the
upstream change deliberately. Keep the sync failing on anything it fails on
today.

## Invariants

Preserve these through any refactor of `.github/workflows/`:

- **Actions pinned to commit SHAs.** `create-pull-request` holds
  `contents: write`; a moved tag is a write path into this repository.
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
