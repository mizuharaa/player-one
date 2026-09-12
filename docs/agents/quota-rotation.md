# Overnight quota rotation and handoff

How several Claude Code accounts keep one piece of work moving when one of them
runs dry, and what gets written down when *all* of them do. Verified on the org
PC on 2026-09-10; the mechanics are in the profile functions and the router,
not in this file.

## The shape

```
builders  ──► claude-router ──► 9router :20128 ──► cc account A ┐
  (any pane)                        │              cc account B ├ round-robin
                                    │              cc account C ┘
                                    └─ combo "night": cc/* → cx/gpt-5.6-sol → ag/gemini-3.8-flash-high
QA auditor ──► claude-qa  ──► Anthropic directly, account D, --permission-mode plan
```

- **Builders never log in to Anthropic directly.** `claude-router` (PowerShell
  profile) starts Claude Code with `CLAUDE_CONFIG_DIR=~/.claude-router`, whose
  `settings.json` points `ANTHROPIC_BASE_URL` at 9router and carries the router
  key. 9router round-robins every Claude account connected in its dashboard, so a
  quota hit on one account is invisible to the session — **same context, no
  handoff.** Verified: `claude -p` through the router answered in 2.3 s.
- **The QA auditor uses a fourth account, direct, in plan mode.** It cannot edit
  and it does not draw from the builders' pool, so it cannot starve them and it
  cannot be the thing it checks. Rule 2 of `CLAUDE.md` is enforced by the account
  boundary, not by asking nicely.
- **The combo is the last resort, not the plan.** When every Claude account is
  dry, 9router falls through to Codex and Gemini models behind the same session.
  Slower and less capable, but the branch keeps moving. Build small features in
  that state; do not start a schema or money change on a fallback model.

## State on 2026-09-11

- Router accounts: **all Claude accounts connected** (owner, 2026-09-11). Which
  account served a call is not visible from `/v1/messages`; trust the dashboard.
- **Combos are empty** (`/v1/models` lists no unprefixed ids), so there is no
  automatic fall-through to `cx/*` or `ag/*` when every Claude account is dry.
  Optional: create `night` = `cc/claude-fable-5-1`, `cc/claude-opus-5`,
  `cx/gpt-5.6-sol`, `ag/gemini-3.8-flash-high` and set `ANTHROPIC_MODEL=night`
  in `~/.claude-router/settings.json`. Without it, exhaustion means a handoff.
- The direct dirs `~/.claude-acct2/3/4` hold **expired** July logins (measured:
  "OAuth session expired"). `claude-acct4` + `/login` once makes `claude-qa` work.

## Traps already met

- **Two 9router instances on one port** hang every provider with `HTTP 000`.
  `netstat -ano | findstr 20128` must show exactly one LISTENING row.
- The router key lives in the `NINE_ROUTER_API_KEY` user variable and in
  `~/.claude-router/settings.json` only — never in a repo file.
- `--model cc/…` works through the router; a bare Anthropic id does not route.

## When a handoff is still needed

Only when the whole pool is exhausted *and* the fallback models are unfit for
the task in hand (schema, money, concurrency, auth). Then the working agent
writes `HANDOFF.md` in its worktree — it is in `.git/info/exclude` with
`PLAN.md` — holding exactly four things:

1. **State** — branch, HEAD sha, dirty files, which tests were last run and their
   pass/fail/skip *as measured*.
2. **Blocked** — what is waiting on whom (credentials, a review, hardware).
3. **In progress** — the slice being built, its gate, and how far it got.
4. **Next** — the ordered next moves with the approach and the files each one
   touches.

An agent that still holds context does not write one. A fresh agent reads
`HANDOFF.md`, then `PLAN.md`, then the branch — in that order — and deletes
`HANDOFF.md` once the state is back in its own head.
