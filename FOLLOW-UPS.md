# Dragon Rematch — open items

Written 2026-09-28. Ordered by what actually matters.

## 1. There is no CI, and that is why this app drifts silently

`dragonrematch` has no `.github/workflows/`. Every release is a hand `fly deploy`,
and because `carveresq-22`'s `PreToolUse` guard blocks that command from any
directory, each one needs the prod lock acquired by hand. The result is exactly
what you would expect: **production sat a commit behind HEAD while every page
returned 200.**

The fix is `deploy.yml` + a Fly deploy token as a repo secret. It was not done
because creating a token and storing it as a secret is a credential action that
needs the owner's say-so, not because it is hard.

**Do the pipeline and the stamp together.** A commit field with nothing
populating it serves `commit: null`, which looks like an answer and is not —
same failure mode as everything else listed here.

## 2. There is no version stamp

No `/api/health`, no build id in the page. Today the only way to tell what is
serving is:

- **Copy stamp** — grep the served HTML for a string that commit introduced.
  One curl, but only works for commits that change visible text.
- **`npm run verify:deployed`** — reconstructs the lazily-loaded chunk set from
  the webpack runtime manifest and greps those, which reaches behaviour-only
  changes. Requires `--control`; see below.

A commit stamp in the page would retire both.

## 3. Checks that examine nothing look exactly like checks that pass

This bit the project repeatedly in one day, in several costumes. Every check
here is built against it, and new ones should be too:

- `scripts/verify-footprint.mjs` compares the cone-ground solve against an
  independent 200k-ray numerical cut, **not** against its own formula. Its
  first version re-derived the boundary with the same rotation, so it only
  compared the function to a copy of itself — and passed a sign error that
  mirrored the hitbox.
- Its safe-point section has a negative control (smother everything, expect
  zero points) **and a control on the control** (lift the cover, expect points
  back). Without the second, "every returned point is safe" passes trivially on
  an empty list.
- `scripts/verify-deployed.mjs` refuses to report a miss unless a `--control`
  string known to be in the running build is found by the same search. A sibling
  app resolved 22 chunks, found zero hits, and would have been reported as "not
  deployed" — the chunks were simply not the ones being served.
- Conversely, an href scan of the carveresq.com catalog reports 32 of 50
  exhibits as broken. They are not: navigation is a React `onClick`, invisible
  to DOM queries. Click and watch for a popup instead.

## 4. Known gaps in the exhibit itself

- **Walking does nothing on the camera path.** Device orientation is rotation
  only; there is no positional tracking without WebXR. Movement is the pad.
  Every attack is bounded by `speed * telegraph` for this reason — see
  `safePointsAround()`.
- **Android WebXR is unverified on hardware.** Implemented, never run on a real
  device.
- **Quick Look shows the dragon at the USDZ's authored scale**, not 6 m.
  `ar-scale="fixed"` honours the asset's units; fixing it means re-exporting the
  asset, not changing code.
- Cosmetic: feet settle 2–3 cm below the floor, because the offset is solved
  once while the idle animation keeps breathing.

## 5. Running the checks

    npm run verify:geometry    # no dependencies
    npm run dev                # then, in another shell:
    npm run verify:fight       # needs: npm i --no-save playwright-core
    npm run verify:deployed -- --control "Place the dragon" --expect "<new string>"
