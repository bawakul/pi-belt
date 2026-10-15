# pi-belt

A three-slot work-in-progress limiter for [pi](https://github.com/earendil-works/pi). One thing per session — and the belt remembers what you were doing.

**The problem it solves:** too many open threads, zero ceremony around finishing them. Every session starts with "what should I work on?" and the answer is usually whatever's shiniest. The belt makes you choose from at most three started things — and makes novelty cost something.

**The idea:** limit work-in-progress to three slots. Picking a slot starts your session pre-loaded with what that work is and why you cared. Adding a fourth thing forces a swap, with a required reason. Discipline over churn.

## Install

```bash
pi install git:github.com/bawakul/pi-belt
```

## How it works

- **Session start** — the picker appears: your three slots, each with its title, one-line pitch, and history. Pick one, or type something else (the escape hatch — recorded, not celebrated).
- **The pick** — the chosen slot becomes the session's opening message: what you're working on, the pitch you wrote when you added it, and any saved context. The agent starts mid-stride, not from zero.
- **During the session** — the active task is written to `~/.pi/agent/memory/next.md`, so external surfaces (e-ink dashboards, status pages) can show what's on the belt.
- **Wrap-up** — finishing is `/next done`: the slot retires to a ledger with a reason. Slots can also be edited or parked for later.

### Commands

| Command | What |
|---|---|
| `/next` | Show the picker / list the belt |
| `/next <task>` | Add a task — you write the pitch first (the sell, while it matters), then pick a project. If the belt is full: choose a victim and give a reason. |
| `/next done` | Retire a slot to the ledger |
| `/next edit` | Edit a slot's title, pitch, project, or context |

## State

All state is plain markdown in `~/.pi/agent/memory/` — human-readable, hand-editable, backed up with your notes:

- `belt.md` — the three slots (id, title, pitch, project, context)
- `belt-stats.md` — pick history, escapes, and the retired ledger
- `next.md` — the active task

The extension is the bouncer: it validates these files on load and repairs or complains if they drift. You can edit them by hand; the belt will keep you honest.

## Philosophy

- **Three slots, no more.** Adding a fourth means swapping one out, with a written reason. The reasons accumulate — an honest record of triage.
- **Escape is allowed.** Sometimes you need to do something else. It's recorded, not punished.
- **Files over databases.** Everything is markdown you can read in ten years.
- **No numbers that need explaining.** If a stat requires a manual, it's out.

## Development

```bash
node --test
```

49 tests, no dependencies beyond pi's own packages.

## License

MIT
