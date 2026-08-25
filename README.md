# AI-Gym

**Version 0.2.0**

A mobile-first, offline-first training log in plain HTML, CSS and JavaScript. No build step, no framework, no npm install, no CDN — open it and it works.

- **Built for the phone**: bottom tab bar, bottom-sheet dialogs, 40px+ touch targets, one column by default, and charts that measure their container instead of being scaled to fit
- **408 built-in exercises**, each with a weighted muscle split and an equipment tag
- **Anatomical heat figures** (anterior + posterior) on every exercise, workout, session and report
- **Workout builder** with sets, reps, load, per-set and per-exercise rest, drag reordering and smart push/pull/legs grouping
- **Session runner** with a rest timer and live volume
- **Progression reports** with least-squares trend lines and a 60-day forecast band
- **Eight ranks scored against world records** for your bodyweight — Diamond is 99% of a world record in *every* exercise you train
- **Friends and head-to-head comparison** through a shared hub
- **Three storage tiers**: IndexedDB always, your own Supabase optionally, a shared hub only for friends
- **Light / dark / AMOLED**, eight colour schemes that also drive the heat gradient, and eight page backgrounds (four static, four animated) built from that same palette — with every panel going translucent so the background reads through the whole page

---

## Running it

```bash
node tools/serve.js
```

Then open <http://localhost:4173>.

You can also open `index.html` straight from the file system — everything is classic scripts and relative paths, so it loads. Two caveats when you do: some browsers block IndexedDB on `file://` (the app detects this and silently falls back to `localStorage`), and the SQL panel in the Control Panel can't `fetch` the schema file, so it tells you to open `sql/user-schema.sql` by hand instead. Running the server avoids both.

Nothing else is required. There is no account, no network call and no cloud dependency in the default path.

---

## Layout

```
index.html            loads everything in dependency order
css/
  theme.css           design tokens, 3 modes, 8 schemes, the heat ramp
  app.css             reset, app shell, component kit
  backgrounds.css     8 page backgrounds, all derived from the scheme palette
js/
  data/muscles.js     38-region muscle taxonomy — the shared vocabulary
  data/exercises.js   GENERATED — do not hand edit
  util.js             DOM factory, formatting, icons, toasts, modals
  db.js               IndexedDB with a localStorage fallback
  anatomy.js          the front/back figures
  charts.js           SVG line/bar/spark charts + linear regression
  ranks.js            1RM estimation, strength scoring, the 8-tier ladder
  store.js            domain model, CRUD, derived stats, events
  supabase.js         dependency-free Supabase REST + auth client
  sync.js             local ⇄ personal project ⇄ hub orchestration
  components.js       shared UI (pickers, editors, rank card, heat panel)
  pages/*.js          the five pages
  app.js              shell, router, theme
sql/
  user-schema.sql     run in YOUR project
  hub-schema.sql      run once in the shared project
tools/
  serve.js            zero-dependency static server
  gen-exercises.js    regenerates js/data/exercises.js
docs/SETUP.md         the full Supabase walkthrough
```

Dependencies run one way: `pages → components → store → db`. Nothing above `store.js` knows how data is persisted, and nothing above `sync.js` knows the cloud exists.

---

## The exercise library

`js/data/exercises.js` is generated. Edit `tools/gen-exercises.js` and re-run:

```bash
node tools/gen-exercises.js
```

The generator expresses the library as base movements plus variant matrices (equipment × angle × grip × stance). A bench press is one muscle map that incline/decline/dumbbell/smith variants *shift* rather than restate, which is what keeps 408 movements internally consistent instead of drifting apart the way a hand-typed list does. It refuses to write if any exercise references a muscle id that is not in the taxonomy.

Users can add, edit and delete exercises freely; those live in IndexedDB and override the built-ins by id.

---

## How ranks work

The yardstick is the **world record for your bodyweight**, and your rank is set by your **weakest** trained movement. A rank therefore means "I am at least this good at everything I do" — never "I have one big lift".

| Rank | Needs, in every exercise you train |
|---|---|
| Wood | — |
| Stone | 30% of a world record |
| Bronze | 42% |
| Iron | 54% |
| Silver | 65% |
| Gold | 78% |
| Platinum | 90% — close to complete |
| **Diamond** | **99% — a world record in all of them** |

Records are stored as a 1RM-to-bodyweight ratio at an 80 kg reference and re-scaled allometrically (strength ≈ mass^⅔), because absolute strength tracks cross-sectional area. A 60 kg lifter is therefore held to a higher bodyweight multiple than a 120 kg lifter for the same rank. 1RM uses Epley up to 10 reps and an Epley/Brzycki average beyond that, where Epley alone starts to overestimate.

The ladder is deliberately punishing. For an 80 kg lifter, held back by their curl in every case:

| Lifter | Bench / Squat / Deadlift / Curl | Floor | Rank |
|---|---|---|---|
| Novice | 40 / 60 / — / 10 | 12% | Wood |
| Intermediate | 100 / 140 / 180 / 20 | 24% | Wood |
| Advanced | 150 / 210 / 260 / 45 | 55% | Iron |
| Near-elite | 200 / 290 / 330 / 75 | 91% | Platinum |

Reaching Stone means 30% of a world record in *everything* you train, so most people sit at Wood for a long time. The percentages look evenly spaced but the difficulty is not — closing 78% → 90% is a far larger job than 30% → 42%.

**Not everything is rank-bearing.** A movement counts toward the floor only if it carries a recorded external load, or is a bodyweight movement whose whole point is maximal effort (pull-up, dip, push-up, pistol). A plank is scored and shown but cannot set your rank, since holding a position is not a one-rep max and crediting it with full bodyweight would let it outscore a real lift.

Standards are held per movement *pattern*, not per exercise, so a lat pulldown is measured against the vertical-pull record rather than against a pulldown-specific one. That is a deliberate approximation — the alternative is a hand-maintained record for all 408 movements.

---

## Layout rules

The app is designed for a phone first and widens from there. Three rules do most of the work:

- **Stack by default, go horizontal only when it fits.** Multi-column grids collapse to one column below 860px. The exceptions are compact stat tiles, which stay two-up because a row each just makes cards taller.
- **Nothing is sized to a fixed pixel width in JS.** Layout lives in CSS so it can respond; inline `gridTemplateColumns` was what squeezed the anatomy figures to 28px wide before this was fixed.
- **Charts measure, they never scale.** Each chart reads its container width and builds its viewBox at that exact pixel size, so one SVG unit is always one CSS pixel and a `ResizeObserver` redraws on rotation. Scaling a fixed-width viewBox to fit compressed the whole plot — tick labels included — by about 2.5x on a phone.

Breakpoints: 1100px (sidebar layout loosens), 860px (sidebar becomes a bottom tab bar), 760px (figure panels stack), 560px (denser list rows), 344px (tiles go single column). A `(hover: none)` block makes row actions permanent and grows hit areas, since a phone never fires hover.

### Translucent surfaces

When a decorative background is selected, every container that would otherwise be an opaque slab — cards, modals, tiles, table headers, the topbar and nav — goes translucent with a backdrop blur, so the background is visible through the page rather than only in the gutters. Selecting **None** restores fully opaque surfaces.

`--surface-alpha` in [css/backgrounds.css](css/backgrounds.css) is the single knob, and it is mode-aware: dark text on a washed-out light panel loses contrast much faster than light text on a dark one, so light mode keeps more body than dark. The shipped values were checked against all 144 mode × scheme × palette-stop combinations — worst-case body text lands at 6.4:1, comfortably past the WCAG AA 4.5:1 threshold. Pushing the alpha much lower starts to fail it, which is why this stops at clearly translucent rather than going fully glassy.

### Running inside a web-to-app wrapper

The app is commonly wrapped as a native shell, where a normal link opens in the shell's own webview and traps you there. Every external link is therefore a `linkRow`: the full URL is shown and selectable, **Open** tries `_system`, then a `rel="external"` anchor click, then `window.open`, and **Copy link** is always there because none of those is guaranteed.

Copying is equally defensive. `U.copy()` tries the async Clipboard API, then `ClipboardItem`, then a contenteditable Range (which is what iOS webviews need — a readonly textarea will not take a selection), then `execCommand` on a textarea. If all four fail, `U.copyOrShow()` puts the text on screen pre-selected with a Share button, so there is always a route to it.

---

## Storage model

1. **IndexedDB** — authoritative for the device. Works offline, never expires, needs no account. If IndexedDB is unavailable the app transparently falls back to `localStorage`.
2. **Your own Supabase project** — optional full mirror. Adds backup, multi-device sync, and lets friends read you.
3. **The hub** — accounts, handles, friendships, and a cached stats roll-up. Never holds training data.

Writes are queued in an `outbox` store, so edits made offline sync when you reconnect rather than being lost. See [`docs/SETUP.md`](docs/SETUP.md) for the security model — in particular why a friend holding your publishable key can read everything and change nothing.

---

## Known limitation: the anatomy figures

![Anterior and posterior muscle figures](docs/anatomy-preview.png)

The muscle figures are hand-authored SVG. Each belly is described as a band of `[y, xInner, xOuter]` rows fitted to measured silhouette bounds, expanded into a Catmull-Rom spline and clipped to the body outline. They cover 98% (anterior) and 99% (posterior) of the muscled body, every region is correctly placed and labelled, and they read clearly at a glance — comparable to the muscle maps in mainstream training apps.

They are **not** at the fidelity of a medical anatomy plate. Reaching that means artwork traced from anatomical references, which is illustration work rather than something to converge on by tuning coordinate arrays.

The code is structured so this is a data swap, not a rewrite: `FRONT_MUSCLES` and `BACK_MUSCLES` in `js/anatomy.js` map muscle ids to path data. Drop in paths from a licensed anatomical SVG keyed by the same ids — or supply `d:` strings directly instead of `rows:`, which the compiler already accepts — and every figure in the app upgrades at once, with no other file touched.

Live Website link: https://eward-nee.github.io/AI-Gym/
