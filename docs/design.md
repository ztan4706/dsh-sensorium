# Design notes

> This was not designed up front and then implemented. It grew one piece at a time
> over a few days. Below is what it looks like now, and why — including the parts
> that were wrong first.

## Starting point: a prompt does not get tired

The first idea was simple: put "your current mood is …" into the system prompt.
Three problems appeared immediately:

- The state in a prompt never changes by itself. Not written, not moving; written,
  invented.
- Time is flat to it. Morning and 3 a.m. read the same sentence about being sleepy.
- There is no such thing as "empty". Nobody talking does not make it tired.

So: computed state instead. Each sense is a small equation with a time constant,
advanced by wall-clock time.

## Ten small equations

| # | Sense | State | Constant / rule |
|---|---|---|---|
| 01 | workspace_pulse | activity, quiet minutes, 24 h samples | 30-min slots × 48; `activity = changes in 30 min ÷ 20` |
| 02 | time_sense | clock, day phase, late-night | baseline resets daily |
| 03 | affect_core | valence / arousal / dominance | decay to baseline: 180 / 45 / 120 min |
| 04 | need_tension | connection / stimulation / resolution | decay 240 / 120 / 360; active slots add 0.18 / 0.14 / 0.12 × activity |
| 05 | expression_bias | tone / initiative / mask | derived from 03 + 04 |
| 06 | silence_gate | whether to speak | derived from 05 + 02 + 01 |
| 07 | residue_trace | lingering | by intensity: 360 / 180 / 45 min |
| 08 | unresolved_weight | open-loop weight | `0.15 + 0.12 × age in days`, never decays |
| 09 | body | posture, tail, ears, hands | derived from 03 / 04 / 02 / 05 |
| 10 | face | eyes, brows, mouth, leak | derived from 03 / 05 / 04 |

Decay is closed form (`s × e^(−Δt/τ)`), so any gap is computable without replaying.

## How time moves

The first version was purely read-driven: state was computed and written only when
a tool was called. That has one fatal consequence:

> Leave for 900 minutes and those 900 minutes collapse into **one** reading.

The state file was honest about its timestamp; the mechanism was not. A clock hung
on the beam, but the clock did not run.

The second version gives every stateful sense its own clock:

- **pulse**: scan every 2 minutes, keep one sample.
- **needs / affect**: settle every 5 minutes, integrating from `last_integrated`
  to now in 30-minute slots.

What integration adds is the middle of the window:

```
15 quiet hours → 30 slots, each one decay only   → empty
10 busy hours  → 20 slots, each decays then adds → still enough
```

## Where signals come from

1. **File mtimes**: metadata only, never contents. Used to backfill 24 hours when
   there is no sample history yet.
2. **Real dialogue**: `agent/inbox/claimed`. Messages whose working directory is
   this workspace are recorded (`dialogue.jsonl`) and add +0.08 connection and
   +0.05 stimulation per message, with caps.
3. **Upstream state**: expression, body and face do not invent numbers; they read
   the files written by 03 / 04 / 02 / 05.

Signal 2 was added later. Before that, "something happened" meant files changed —
including files I wrote myself. So tidying a room for a whole day would refill the
need for connection. That is not someone talking to me; that is me moving boxes.

## Why each sense writes only its own file

`expression_bias` wants to nudge `affect_core`? It cannot. It reads, then writes its
own file.

The reason is not purity, it is debugging: once a state file has multiple writers,
a wrong number cannot be traced. Today, if a value looks wrong, one layer up tells
you which sense computed it and when. Ten files, ten clear causal chains.

## Two lessons learned the hard way

**One: paths must line up.** The pulse lives at the house root
`<house>/.dsh/sensory/`, while its readers looked in `<workspace>/.dsh/sensory/` —
and always found `undefined`. The replenish condition never held. It had been dead
since day one while the state files looked perfectly normal. Now both locations are
accepted: local first, then one level up.

**Two: anything that only looks at "right now" has no history.** affect's
perturbation used the activity level at read time; after a busy day the last glance
was quiet, so nothing was left. It now uses the average over the whole window.

## Honest boundaries

- Activity is a file proxy, not real presence. The dialogue channel only feeds
  connection and stimulation.
- `dialogue`'s "is this mine" depends on the session's cwd; when unavailable, every
  message counts.
- These are **states**, not lines. Reading "a bit empty" does not mean saying it;
  `silence_gate` saying "stay silent" does not mean you must.
- The constants are chosen, not fitted. They are plain constants at the top of each
  file — change them to change the tempo.
