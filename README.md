# AI-Gym

An offline-first training log in plain HTML, CSS and JavaScript. No build step, no framework, no npm install, no CDN — open it and it works.

- **408 built-in exercises**, each with a weighted muscle split and an equipment tag
- **Anatomical heat figures** (anterior + posterior) on every exercise, workout, session and report
- **Workout builder** with sets, reps, load, per-set and per-exercise rest, drag reordering and smart push/pull/legs grouping
- **Session runner** with a rest timer and live volume
- **Progression reports** with least-squares trend lines and a 60-day forecast band
- **Eight ranks**, Wood → Diamond, where Diamond requires being strong *everywhere*
- **Friends and head-to-head comparison** through a shared hub
- **Three storage tiers**: IndexedDB always, your own Supabase optionally, a shared hub only for friends
- **Light / dark / AMOLED**, and eight colour schemes that also drive the heat gradient

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

Points run 0–3200 and blend four indices, so a rank describes an athlete rather than one lift:

| Index | Weight | What it measures |
|---|---|---|
| Strength | 60% | estimated 1RM against bodyweight-relative elite standards, averaged over your best 10 movements |
| Consistency | 18% | sessions logged in the last 28 days |
| Volume | 12% | 28-day tonnage, log-scaled |
| Balance | 10% | Shannon evenness across the seven muscle groups |

1RM uses Epley up to 10 reps and an Epley/Brzycki average beyond that, where Epley alone starts to overestimate.

**Diamond has an extra gate.** Points alone are not enough: it also needs at least 12 distinct movements logged, at least 5 muscle groups trained, and the *weakest* trained group scoring 70+. That is what makes the top tier mean "elite across everything you do" instead of "one enormous deadlift".

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
