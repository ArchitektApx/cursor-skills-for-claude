#!/usr/bin/env node
// Regenerates this repository from the upstream cursor/plugins tree.
//
//   node scripts/sync.mjs            clone upstream, regenerate everything
//   node scripts/sync.mjs --verify   offline consistency checks only
//
// Nothing in this repository is edited by hand except sync.config.json,
// README.md and NOTICE. Everything else is output.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const CONFIG = readJson(path.join(ROOT, 'sync.config.json'))
const STATE_FILE = path.join(ROOT, '.sync-state.json')
const REPORT_FILE = path.join(ROOT, '.sync-report.md')
const MARKETPLACE_FILE = path.join(ROOT, '.claude-plugin', 'marketplace.json')

// Cursor agent frontmatter keys that Claude Code does not understand.
// `model: fast` is a Cursor tier name; Claude wants one of its own values.
const AGENT_MODEL_MAP = { fast: 'haiku', max: 'opus', smart: 'sonnet' }
const AGENT_DROP_KEYS = new Set(['is_background'])

const problems = []

if (process.argv.includes('--verify')) {
  verify()
} else {
  sync()
}

function sync() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-plugins-'))
  try {
    const upstream = checkout(tmp)
    const previous = fs.existsSync(STATE_FILE) ? readJson(STATE_FILE) : null

    // Regenerate from scratch so upstream deletions propagate instead of
    // leaving orphaned skills behind.
    for (const dir of ['plugins', 'skills']) rmrf(path.join(ROOT, dir))

    const extras = []
    const catalog = []
    for (const plugin of CONFIG.plugins) {
      const built = buildPlugin(plugin, upstream.dir)
      extras.push(...built.extras)
      catalog.push({ plugin, skills: built.catalog })
    }

    // Bail before touching the manifests or the README, so a failed sync
    // cannot leave a half-built catalog describing a tree that never built.
    fail('Sync failed')

    writeMarketplace()
    writeReadmeCatalog(catalog)
    writeAgentsMirror()
    writeJson(STATE_FILE, {
      upstream: CONFIG.upstream.repo,
      ref: CONFIG.upstream.ref,
      commit: upstream.commit,
      committedAt: upstream.committedAt,
      syncedFrom: previous?.commit ?? null,
    })

    fail('Sync failed')

    verifyMirrors()
    fail('Mirror verification failed')

    fs.writeFileSync(REPORT_FILE, report(upstream, previous, extras))
    console.log(`\nSynced ${CONFIG.plugins.length} plugins from ${upstream.commit.slice(0, 12)}.`)
    if (extras.length) {
      console.log(`\n${extras.length} upstream skill(s) not in the allowlist:`)
      for (const e of extras) console.log(`  ${e.plugin}/${e.skill}`)
    }
  } finally {
    rmrf(tmp)
  }
}

// --- upstream ----------------------------------------------------------------

function checkout(tmp) {
  const dir = path.join(tmp, 'upstream')
  // Blobless clone keeps full history (needed for the PR changelog range)
  // while downloading only the file contents the sparse paths ask for.
  git(tmp, ['clone', '--filter=blob:none', '--sparse', '--quiet', CONFIG.upstream.repo, dir])
  git(dir, ['checkout', '--quiet', CONFIG.upstream.ref])
  git(dir, ['sparse-checkout', 'set', ...CONFIG.plugins.map((p) => p.upstreamPath)])
  return {
    dir,
    commit: git(dir, ['rev-parse', 'HEAD']),
    committedAt: git(dir, ['log', '-1', '--format=%cI']),
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

// --- generation --------------------------------------------------------------

function buildPlugin(plugin, upstreamDir) {
  const src = path.join(upstreamDir, plugin.upstreamPath)
  if (!fs.existsSync(src)) {
    problems.push(`upstream path missing: ${plugin.upstreamPath}`)
    return []
  }

  const dest = path.join(ROOT, 'plugins', plugin.name)
  fs.mkdirSync(path.join(dest, 'skills'), { recursive: true })

  for (const skill of plugin.skills) {
    const from = path.join(src, 'skills', skill)
    if (!fs.existsSync(path.join(from, 'SKILL.md'))) {
      // Loud, not silent: an allowlisted skill that vanished upstream is a
      // decision for a human, not something to quietly drop from the catalog.
      problems.push(`${plugin.name}: allowlisted skill has no SKILL.md upstream: ${skill}`)
      continue
    }
    if (!assertSafeTree(from, `${plugin.name}/${skill}`)) continue
    fs.cpSync(from, path.join(dest, 'skills', skill), { recursive: true })
  }

  // Runs before mirroring so the flat copy inherits the rewrites.
  applyRewrites(plugin, dest)

  for (const agent of plugin.agents ?? []) {
    const from = path.join(src, 'agents', agent)
    if (!fs.existsSync(from)) {
      problems.push(`${plugin.name}: allowlisted agent missing upstream: ${agent}`)
      continue
    }
    fs.mkdirSync(path.join(dest, 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dest, 'agents', agent), translateAgent(fs.readFileSync(from, 'utf8'), `${plugin.name}/${agent}`))
  }

  for (const file of ['LICENSE', 'CHANGELOG.md']) {
    const from = path.join(src, file)
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dest, file))
  }

  writeJson(path.join(dest, '.claude-plugin', 'plugin.json'), {
    name: plugin.name,
    description: plugin.description,
    version: readJson(path.join(src, '.cursor-plugin', 'plugin.json'))?.version ?? '0.0.0',
    author: CONFIG.marketplace.owner,
    homepage: CONFIG.marketplace.repository,
    repository: CONFIG.marketplace.repository,
    license: 'MIT',
  })

  // The Vercel `npx skills` CLI only scans known container directories, so
  // mirrored skills go to a flat root-level skills/ tree. Only one plugin may
  // mirror a given skill name; the CLI installs flat by frontmatter name.
  if (plugin.mirror) {
    for (const skill of plugin.skills) {
      const from = path.join(dest, 'skills', skill)
      const to = path.join(ROOT, 'skills', skill)
      if (!fs.existsSync(from)) continue
      if (fs.existsSync(to)) {
        problems.push(`mirror name collision on "${skill}" — only one plugin may set mirror: true for it`)
        continue
      }
      fs.cpSync(from, to, { recursive: true })
    }
  }

  const available = listDirs(path.join(src, 'skills'))
  return {
    extras: available.filter((s) => !plugin.skills.includes(s)).map((skill) => ({ plugin: plugin.name, skill })),
    catalog: readSkillCatalog(plugin, src),
  }
}

// Pulls the one-line skill descriptions out of the upstream plugin README's
// Skills table, so our README stays accurate without anyone rewriting it.
// Rows keep upstream's ordering, which is curated rather than alphabetical.
function readSkillCatalog(plugin, src) {
  const file = path.join(src, 'README.md')
  if (!fs.existsSync(file)) {
    problems.push(`${plugin.name}: upstream README.md missing, cannot build skill catalog`)
    return []
  }

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  // Scope to the Skills table: the same README also has an Agents table, and
  // in cursor-team-kit one agent shares a skill's name.
  const start = lines.findIndex((l) => /^#{2,4}\s+Skills\s*$/.test(l))
  if (start === -1) {
    problems.push(`${plugin.name}: no "Skills" heading in upstream README.md`)
    return []
  }

  const rows = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break
    const cells = /^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/.exec(line)
    if (cells) rows.push({ name: cells[1], description: sanitize(cells[2].replace(/\.$/, '')) })
  }

  const found = new Set(rows.map((r) => r.name))
  for (const skill of plugin.skills) {
    if (!found.has(skill)) {
      problems.push(`${plugin.name}: no README table row for allowlisted skill "${skill}"`)
    }
  }

  return rows.filter((r) => plugin.skills.includes(r.name))
}

// Agents that read AGENTS.md rather than CLAUDE.md should get the same context.
// A copy rather than a symlink: GitHub renders a symlinked markdown file as a
// path stub, and a Windows checkout without symlink support turns it into a
// one-line file containing the target path.
function writeAgentsMirror() {
  fs.copyFileSync(path.join(ROOT, 'CLAUDE.md'), path.join(ROOT, 'AGENTS.md'))
}

// Upstream README prose lands inside our own README, so neutralize the
// characters that would let it escape the table cell or, worse, forge a
// catalog marker and hijack the region on the next run.
function sanitize(text) {
  return text
    .replace(/<!--/g, '&lt;!--')
    .replace(/-->/g, '--&gt;')
    .replace(/\\?\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

// Rewrites the region between the catalog markers in README.md, leaving the
// rest of the hand-written file alone.
function writeReadmeCatalog(catalog) {
  const file = path.join(ROOT, 'README.md')
  const readme = fs.readFileSync(file, 'utf8')
  const [open, close] = ['<!-- skills:start -->', '<!-- skills:end -->']
  const from = readme.indexOf(open)
  const to = readme.indexOf(close)
  if (from === -1 || to === -1) {
    problems.push(`README.md is missing the ${open} / ${close} markers`)
    return
  }

  const body = catalog
    .map(({ plugin, skills }) => {
      const agents = plugin.agents?.length ?? 0
      // Counts live in the generated region so they cannot drift from the
      // allowlist the way a hand-written summary table would.
      const counts = [`${skills.length} skills`, agents ? `${agents} subagents` : null].filter(Boolean).join(' · ')
      return [
        `### \`${plugin.name}\` · ${counts}`,
        '',
        '| Skill | Description |',
        '| :--- | :--- |',
        ...skills.map((s) => `| \`${s.name}\` | ${s.description} |`),
      ].join('\n')
    })
    .join('\n\n')

  fs.writeFileSync(file, `${readme.slice(0, from + open.length)}\n\n${body}\n\n${readme.slice(to)}`)
}

// Upstream decides what lives inside a skill directory. A symlink would be
// copied as a symlink and then redistributed to everyone who installs this
// marketplace, pointing wherever upstream chose. Nothing upstream ships today
// contains one, so refuse rather than reason about it.
function assertSafeTree(dir, label) {
  let ok = true
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const rel = path.relative(dir, path.join(entry.parentPath, entry.name))
    if (entry.isSymbolicLink()) {
      problems.push(`${label}: refusing to copy symlink ${rel}`)
      ok = false
    } else if (entry.isFile() && (fs.statSync(path.join(dir, rel)).mode & 0o111) !== 0) {
      problems.push(`${label}: refusing to copy executable file ${rel}`)
      ok = false
    }
  }
  return ok
}

// Targeted string replacements declared in sync.config.json, used to strip
// agent-specific wording from skills that are otherwise agent-agnostic.
// A rewrite whose `from` no longer appears is a hard failure: upstream reworded
// the line, and silently doing nothing would ship the Cursor-specific text.
function applyRewrites(plugin, dest) {
  for (const rule of plugin.rewrites ?? []) {
    const label = `${plugin.name}/${rule.skill}/${rule.file}`
    const file = path.join(dest, 'skills', rule.skill, rule.file)
    if (!fs.existsSync(file)) {
      problems.push(`rewrite target missing: ${label}`)
      continue
    }
    const before = fs.readFileSync(file, 'utf8')
    if (!before.includes(rule.from)) {
      problems.push(`rewrite no longer matches (upstream reworded it?): ${label} — expected "${rule.from}"`)
      continue
    }
    fs.writeFileSync(file, before.replaceAll(rule.from, rule.to))
  }
}

function translateAgent(text, label) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) {
    problems.push(`${label}: no frontmatter block`)
    return text
  }

  const lines = match[1].split(/\r?\n/)
  const kept = []
  for (const line of lines) {
    const key = /^([A-Za-z0-9_-]+):/.exec(line)?.[1]
    if (key && AGENT_DROP_KEYS.has(key)) continue
    if (key === 'model') {
      const value = line.slice(line.indexOf(':') + 1).trim()
      const mapped = AGENT_MODEL_MAP[value]
      if (mapped) {
        kept.push(`model: ${mapped}`)
      } else if (/^(opus|sonnet|haiku|inherit|claude-)/.test(value)) {
        kept.push(line)
      } else {
        // An unrecognized model value would make Claude reject the agent.
        // Dropping the key falls back to the session model, which still works.
        console.warn(`  note: ${label} dropped unmappable "model: ${value}"`)
      }
      continue
    }
    kept.push(line)
  }

  return `---\n${kept.join('\n')}\n---\n` + text.slice(match[0].length)
}

function writeMarketplace() {
  writeJson(MARKETPLACE_FILE, {
    name: CONFIG.marketplace.name,
    owner: CONFIG.marketplace.owner,
    metadata: { description: CONFIG.marketplace.description },
    plugins: CONFIG.plugins.map((p) => ({
      name: p.name,
      source: `./plugins/${p.name}`,
      description: p.description,
    })),
  })
}

// --- verification ------------------------------------------------------------

function verify() {
  if (!fs.existsSync(MARKETPLACE_FILE)) problems.push('.claude-plugin/marketplace.json missing — run the sync')
  if (!fs.existsSync(STATE_FILE)) problems.push('.sync-state.json missing — run the sync')

  for (const plugin of CONFIG.plugins) {
    for (const skill of plugin.skills) {
      const skillFile = path.join(ROOT, 'plugins', plugin.name, 'skills', skill, 'SKILL.md')
      if (!fs.existsSync(skillFile)) problems.push(`missing generated skill: ${plugin.name}/${skill}`)
    }
    for (const agent of plugin.agents ?? []) {
      if (!fs.existsSync(path.join(ROOT, 'plugins', plugin.name, 'agents', agent))) {
        problems.push(`missing generated agent: ${plugin.name}/${agent}`)
      }
    }
  }

  const expected = CONFIG.plugins.map((p) => p.name).sort()
  const actual = listDirs(path.join(ROOT, 'plugins')).sort()
  if (expected.join() !== actual.join()) {
    problems.push(`plugins/ holds [${actual}] but config declares [${expected}]`)
  }

  verifyMirrors()
  fail('Verification failed')
  console.log('Verification passed.')
}

function verifyMirrors() {
  const claude = path.join(ROOT, 'CLAUDE.md')
  const agents = path.join(ROOT, 'AGENTS.md')
  if (!fs.existsSync(agents)) {
    problems.push('AGENTS.md missing — run the sync')
  } else if (!fs.readFileSync(agents).equals(fs.readFileSync(claude))) {
    problems.push('AGENTS.md differs from CLAUDE.md — edit CLAUDE.md and run the sync')
  }

  const mirrored = new Set()
  for (const plugin of CONFIG.plugins.filter((p) => p.mirror)) {
    for (const skill of plugin.skills) {
      mirrored.add(skill)
      const canonical = path.join(ROOT, 'plugins', plugin.name, 'skills', skill)
      const mirror = path.join(ROOT, 'skills', skill)
      if (!fs.existsSync(mirror)) {
        problems.push(`mirror missing: skills/${skill}`)
        continue
      }
      const drift = diffTrees(canonical, mirror)
      if (drift) problems.push(`mirror drift in skills/${skill}: ${drift}`)
    }
  }
  for (const stray of listDirs(path.join(ROOT, 'skills'))) {
    if (!mirrored.has(stray)) problems.push(`stray mirror not declared by any plugin: skills/${stray}`)
  }
}

function diffTrees(a, b) {
  const listing = (dir) =>
    fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
      .sort()

  const [fa, fb] = [listing(a), listing(b)]
  if (fa.join() !== fb.join()) return 'file lists differ'
  for (const rel of fa) {
    if (!fs.readFileSync(path.join(a, rel)).equals(fs.readFileSync(path.join(b, rel)))) {
      return `content differs in ${rel}`
    }
  }
  return null
}

// --- reporting ---------------------------------------------------------------

function report(upstream, previous, extras) {
  const lines = [
    `Regenerated from [\`${upstream.commit.slice(0, 12)}\`](${CONFIG.upstream.repo}/commit/${upstream.commit}) on \`${CONFIG.upstream.ref}\`, committed ${upstream.committedAt}.`,
    '',
  ]

  if (previous?.commit && previous.commit !== upstream.commit) {
    const log = tryGit(upstream.dir, ['log', '--oneline', '--no-decorate', `${previous.commit}..${upstream.commit}`])
    lines.push(`### Upstream commits since \`${previous.commit.slice(0, 12)}\``, '')
    lines.push(log ? '```\n' + log + '\n```' : '_History range unavailable (upstream may have been rewritten)._')
    lines.push('')
  }

  if (extras.length) {
    lines.push('### Upstream skills not in the allowlist', '')
    lines.push('Add any you want to `sync.config.json` and re-run the sync.', '')
    for (const e of extras) lines.push(`- \`${e.plugin}/${e.skill}\``)
    lines.push('')
  }

  return lines.join('\n')
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args)
  } catch {
    return null
  }
}

// --- helpers -----------------------------------------------------------------

function fail(heading) {
  if (!problems.length) return
  console.error(`\n${heading}:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

function readJson(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}
