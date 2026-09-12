/**
 * What every lane is doing, computed fresh. `pnpm lanes`.
 *
 * This is deliberately NOT a file anybody writes to. `CODEX_BRIDGE.md` was a
 * shared ledger, reached 460 KB, rotted between reads and is retired; CLAUDE.md
 * bans starting another one. Everything below is derived from Git and the
 * filesystem at the moment you run it, so it cannot be stale and there is
 * nothing to keep up to date.
 *
 * It answers the four questions that cause collisions between panes:
 *   who is on what branch, and how far from main
 *   what each lane is editing right now
 *   what task each lane is on (the frozen PLAN.md header)
 *   which lanes are touching the same file  <- the one that actually bites
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Trailing newlines only. `git status --porcelain` puts the status in the
// first two columns, so a plain trim() eats the leading space of a modified
// file and takes the first letter of its path with it.
const git = (args, cwd) => {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.replace(/\n+$/, '');
  } catch {
    return '';
  }
};

const root = git(['rev-parse', '--show-toplevel'], process.cwd()) || process.cwd();
const main = git(['rev-parse', 'origin/main'], root) || git(['rev-parse', 'main'], root);

// `git worktree list --porcelain` is the only source of truth for who exists.
const worktrees = [];
let cur = null;
for (const line of git(['worktree', 'list', '--porcelain'], root).split('\n')) {
  if (line.startsWith('worktree ')) {
    cur = { path: line.slice(9), branch: '(detached)' };
    worktrees.push(cur);
  } else if (line.startsWith('branch ') && cur) {
    cur.branch = line.slice(7).replace('refs/heads/', '');
  }
}

const lanes = worktrees.map((w) => {
  const head = git(['rev-parse', '--short', 'HEAD'], w.path);
  const ahead = git(['rev-list', '--count', `${main}..HEAD`], w.path);
  const behind = git(['rev-list', '--count', `HEAD..${main}`], w.path);

  // Uncommitted work: what this lane is editing this second.
  const dirty = git(['status', '--porcelain'], w.path)
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ''));

  // Committed but unmerged: what this lane has already done.
  const landed = git(['diff', '--name-only', `${main}...HEAD`], w.path).split('\n').filter(Boolean);

  // The task, from the frozen spec header. One line, never the whole file.
  const planPath = join(w.path, 'PLAN.md');
  let task = '';
  if (existsSync(planPath)) {
    const first = readFileSync(planPath, 'utf8').split('\n', 1)[0] ?? '';
    task = first.replace(/^#\s*PLAN\s*-\s*/, '').trim();
  }

  return { ...w, head, ahead: +ahead || 0, behind: +behind || 0, dirty, landed, task };
});

// Overlap is the whole point: two lanes touching one file is a merge conflict
// that has not happened yet. Committed and uncommitted both count.
const owners = new Map();
for (const l of lanes) {
  for (const f of new Set([...l.dirty, ...l.landed])) {
    if (!owners.has(f)) owners.set(f, []);
    owners.get(f).push(l.branch);
  }
}
const clashes = [...owners.entries()].filter(([, who]) => who.length > 1);

const name = (p) => p.split(/[\\/]/).pop();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

console.log(`main ${main.slice(0, 7)}   ${plural(lanes.length, 'worktree', 'worktrees')}\n`);

for (const l of lanes.sort((a, b) => b.dirty.length - a.dirty.length)) {
  const drift = [l.ahead ? `+${l.ahead}` : '', l.behind ? `-${l.behind}` : ''].filter(Boolean).join(' ') || 'even';
  console.log(`${name(l.path)}  [${l.branch}]  ${l.head}  ${drift}`);
  if (l.task) console.log(`   task: ${l.task}`);
  if (l.dirty.length) {
    console.log(`   editing: ${l.dirty.slice(0, 6).join(', ')}${l.dirty.length > 6 ? ` +${l.dirty.length - 6} more` : ''}`);
  }
  if (l.behind > 0 && (l.dirty.length || l.ahead)) {
    console.log(`   stale: ${plural(l.behind, 'commit', 'commits')} behind main, rebase before you merge`);
  }
  console.log('');
}

if (clashes.length === 0) {
  console.log('no two lanes touch the same file.');
} else {
  console.log(`${plural(clashes.length, 'file', 'files')} touched by more than one lane:`);
  for (const [f, who] of clashes.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${f}  <- ${who.join(', ')}`);
  }
}
