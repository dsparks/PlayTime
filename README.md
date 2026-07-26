# PlayTime

A substitution clock for the coach of a very young football team — the one
who is also the referee, the timekeeper, and somebody's parent.

Open `index.html`. That is the whole app: one file, no build, no accounts,
nothing to install. State lives in the browser, so the phone that ran last
week's match already knows the team.

## What it is for

Standing on a touchline, in the sun, with eight five-year-olds and a
whistle, there is exactly one question worth answering:

> **Who comes off, who goes on, and how long until then?**

Everything on the match screen answers that question. Everything else is
one tap away and out of the road.

## How a match goes

1. **Who turned up** — tap the faces that showed. The team list is saved;
   attendance is the only pre-match chore.
2. **Set the lineup** — the app picks a fair starting XI and shows you the
   minutes everyone is on course for. Shuffle if you fancy a different one.
3. **Kick off** — the clock is yours, because in this league nobody else
   is keeping one.
4. **The buzzer goes every four minutes.** The clock stops, the screen
   fills with two names in orange and two in teal, and one button says
   *Done — play on*. Tap it when the swap has actually happened.
5. **Half time and full time** take care of themselves, with the score and
   everyone's minutes laid out, and a summary you can copy into the team
   chat.

## The fairness bit

Minutes are counted from the real clock, not from the plan — if a swap
takes forty seconds to organise, those forty seconds go to whoever was
actually standing on the grass.

At each swap the app puts on the players who have played least. That one
rule is self-stabilising (the children coming on are, by definition, not
about to be pulled straight off again) and it self-corrects: a late
arrival, an early departure, a manual swap, an injury — the next swap
simply looks at who is behind and fixes it. Nothing needs regenerating.

`test/logic.test.mjs` proves the properties that matter — even squads come
out dead level, awkward ones stay within a single stint of each other, and
nobody is ever left on ahead of a player with fewer minutes.

## Things worth knowing

- **Daylight mode** (Settings → Screen) is a genuine high-contrast mode for
  bright sun, not a decorative light theme.
- **Coming off is orange, going on is teal.** That pairing stays legible
  for colour-blind coaches, which green-and-red does not — and both columns
  are labelled and arrowed anyway.
- **The buzzer is a square-wave blast**, not a polite chime, because you
  will be looking at the pitch and not at the phone. It vibrates too.
- **Keepers are off by default.** Turn them on in Settings and the violet
  keeper handling appears; leave them off and it stays completely out of
  sight.
- **Subbing on the fly?** Turn off *Stop the clock at every swap* and the
  clock runs straight through the buzzer.
- **Undo** is on the toast after every swap and goal, in the match sheet,
  and on Ctrl/Cmd-Z.
- The screen is kept awake while the clock runs, and a reload mid-match
  picks the clock back up where it was.

## Tests

```
node test/logic.test.mjs    # the rotation planner
node test/smoke.test.mjs    # every screen and transition, against a DOM stub
```

Both lift their code straight out of `index.html`, so they cannot drift
from what ships.
