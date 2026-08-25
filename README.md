# AI-Gym

**Version 0.5.0**

A mobile-first, offline-first training log in plain HTML, CSS and JavaScript. No build step, no framework, no npm install, no CDN — open it and it works.

- **Built for the phone**: bottom tab bar, bottom-sheet dialogs, 40px+ touch targets, one column by default, and charts that measure their container instead of being scaled to fit
- **468 built-in exercises**, each with a weighted muscle split, an equipment tag and its own world record — including wide/close grip variants across the bar movements
- **Anatomical heat figures** (anterior + posterior) on every exercise, workout, session and report
- **Workout builder** with sets, reps, load, per-set and per-exercise rest, drag reordering and smart push/pull/legs grouping
- **Session runner** with a rest timer and live volume
- **Progression reports** with least-squares trend lines and a 60-day forecast band
- **Eight ranks scored against world records** for your bodyweight — your rank is the average across everything you train, and Diamond is 99%
- **In-app update check** against GitHub releases, with an update that never costs you work in progress
- **End-to-end encryption** of everything written to the cloud — AES-GCM with a key that never leaves your devices in the clear
- **Invite codes** for adding friends: generate, share, redeem — redeeming is the acceptance
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
  crypto.js           AES-GCM sealing, PBKDF2 key wrapping, key escrow
  update.js           version check + resume-after-reload snapshots
  pages/*.js          the five pages
  app.js              shell, router, theme
sql/
  user-schema.sql     run in YOUR project
  hub-schema.sql      run once in the shared project
tools/
  serve.js            zero-dependency static server
  gen-exercises.js    regenerates js/data/exercises.js
version.json          the deployed version, used by the update check
docs/SETUP.md         the full Supabase walkthrough
```

Dependencies run one way: `pages → components → store → db`. Nothing above `store.js` knows how data is persisted, and nothing above `sync.js` knows the cloud exists.

---

## The exercise library

`js/data/exercises.js` is generated. Edit `tools/gen-exercises.js` and re-run:

```bash
node tools/gen-exercises.js
```

The generator expresses the library as base movements plus variant matrices (equipment × angle × grip × stance). A bench press is one muscle map that incline/decline/dumbbell/smith variants *shift* rather than restate, which is what keeps 468 movements internally consistent instead of drifting apart the way a hand-typed list does. It refuses to write if any exercise references a muscle id that is not in the taxonomy.

Users can add, edit and delete exercises freely; those live in IndexedDB and override the built-ins by id.

---

## How ranks work

The yardstick is the **world record for your bodyweight**, and your rank is the **average** across every movement you train. One weak accessory drags the number down without capping you outright.

| Rank | Needs, averaged across everything you train |
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

The ladder is steep at the top and gentler at the bottom. For an 80 kg lifter:

| Lifter | Bench / Squat / Deadlift / Curl | Average | Rank |
|---|---|---|---|
| Beginner | 40 / 60 / — / 10 | 18% | Wood |
| Intermediate | 100 / 140 / 180 / 20 | 45% | Bronze |
| Advanced | 150 / 210 / 260 / 45 | 71% | Silver |
| Near-elite | 200 / 290 / 330 / 75 | 98% | Gold* |

\* capped — see below.

**The top two ranks need breadth.** Platinum and Diamond additionally require at least **8 scored movements**. Without that, a single heavy deadlift and nothing else would average 99% and hand out Diamond, making the hardest tier the easiest one to game. The near-elite lifter above trains only four movements, so they are held at Gold until they log more.

### Per-exercise records

Every exercise carries its own world record, entered when you create it and pre-filled from the movement pattern. It is stored alongside the bodyweight it applies to, so it re-scales allometrically exactly like the built-in ratios do — otherwise gaining or losing weight would silently change how close to a record you appear to be.

The pattern table is only a fallback. "The vertical-pull record" is a coarse stand-in for a hundred different movements, and the person doing the lift knows their sport better than a lookup table does, so a record you enter always wins.

**Not everything is rank-bearing.** A movement counts toward the average only if it carries a recorded external load, or is a bodyweight movement whose whole point is maximal effort (pull-up, dip, push-up, pistol). A plank is scored and shown but cannot set your rank, since holding a position is not a one-rep max and crediting it with full bodyweight would let it outscore a real lift.

Standards are held per movement *pattern*, not per exercise, so a lat pulldown is measured against the vertical-pull record rather than against a pulldown-specific one. That is a deliberate approximation — though a record you enter on any individual exercise overrides it.

---

## Layout rules

The app is designed for a phone first and widens from there. Three rules do most of the work:

- **Stack by default, go horizontal only when it fits.** Multi-column grids collapse to one column below 860px. The exceptions are compact stat tiles, which stay two-up because a row each just makes cards taller.
- **Nothing is sized to a fixed pixel width in JS.** Layout lives in CSS so it can respond; inline `gridTemplateColumns` was what squeezed the anatomy figures to 28px wide before this was fixed.
- **Charts measure, they never scale.** Each chart reads its container width and builds its viewBox at that exact pixel size, so one SVG unit is always one CSS pixel and a `ResizeObserver` redraws on rotation. Scaling a fixed-width viewBox to fit compressed the whole plot — tick labels included — by about 2.5x on a phone.

Breakpoints: 1100px (sidebar layout loosens), 860px (sidebar becomes a bottom tab bar), 760px (figure panels stack), 560px (denser list rows), 344px (tiles go single column). A `(hover: none)` block makes row actions permanent and grows hit areas, since a phone never fires hover.

### Backgrounds and translucent surfaces

Backgrounds are three absolutely-positioned layers in a fixed host, each built from the scheme palette. When one is selected, every container that would otherwise be an opaque slab — cards, modals, tiles, table headers, the topbar and nav — goes translucent so the background reads through the whole page. Selecting **None** restores fully opaque surfaces.

**Performance is the design constraint.** An earlier version ran two viewport-sized layers under `filter: blur(70px)` while animating them, and put `backdrop-filter` on every card. Those are two of the most expensive things a mobile browser can be asked to do — a large blur re-rasterises as the layer moves, and each backdrop-filter forces a compositing layer that re-reads what is behind it on every paint. The current version has **no `filter` or `backdrop-filter` in the running app at all**: softness comes from wide radial-gradient falloffs, which cost nothing, and only `transform`/`opacity` are animated so frames never leave the compositor. `will-change` and layer activation are both opt-in per background, so nothing is promoted that does not move.

Two knobs in [css/backgrounds.css](css/backgrounds.css), both mode-aware: `--bg-alpha` (how strong the background reads) and `--surface-alpha` (how transparent panels are). Dark text on a washed-out light panel loses contrast much faster than light text on a dark one, so the values differ per mode, and dark modes also lift `--text-2`/`--text-3` a step while a background is active — a bold background washes a dark panel *lighter*, which eats light-on-dark contrast. Checked across all 144 mode × scheme × palette-stop combinations: worst-case body text 6.2:1, worst muted text 3.2:1, zero WCAG AA failures.

One gotcha worth recording: `radial-gradient(closest-side …)` anchored at an edge (`at 50% 0%`) collapses to a zero radius and paints nothing. Every gradient here uses explicit size pairs instead.

### Updating

The app checks GitHub releases for a newer version (falling back to the deployed `version.json`, since a build can be live before anyone tags a release) at most four times a day, and offers an update. There is also a manual check in the Control Panel.

**An update never costs you work in progress.** Pages register a snapshot provider; the snapshot is written to IndexedDB on every edit and on `pagehide`/`visibilitychange`, so an OS-initiated kill is survivable too, not just our own reload. Take an update mid-workout and you come back to the same sets ticked, the same weights entered, and the elapsed clock still counting from the original start rather than restarting at zero. The reload carries a cache-busting query so an edge cache hands over the new build rather than the one it already has.

### Encryption

Everything the app writes to a Supabase project is encrypted on your device first. One random AES-GCM-256 **data key** per account, generated locally and never transmitted in the clear. Each record gets a fresh IV, and GCM authenticates as well as encrypts, so tampering is detected rather than silently decrypted into nonsense.

To let a second device read your data, the key is **wrapped** with a key derived from your account password (PBKDF2-SHA256, 310k iterations, random salt) and the wrapped blob is stored in the hub. The hub therefore holds ciphertext it cannot read. Sign in on a new device, enter the password, and the key comes back — along with your project URL and keys, so the connection restores itself rather than asking you to paste anything.

Credentials stored in the hub are encrypted too. If yours were written by a build that predates this — or before the key had finished loading — the app notices on launch and re-publishes them sealed, so a plaintext key does not sit there indefinitely.

**What is not encrypted, deliberately.** The aggregate stats you publish for friends, and the promoted columns your own project indexes on (name, date, volume). The aggregates are the thing you are explicitly choosing to share, so encrypting them would break the feature they exist for; the promoted columns have to stay readable for the database to sort and filter. Treat those as visible to anyone holding your publishable key — the detail behind them is not.

**The trade-off worth knowing:** lose the account password and the encrypted data is unrecoverable. A password reset through Supabase auth does not help, because the old password was the only thing that could unwrap the key. This is what end-to-end actually means — there is no one who can let you back in.

### Project schema versions

The app declares the project schema version it needs and checks the connected project on launch. When they differ it offers a migration: automatic from v2 onward through `gym_migrate()`, which only ever adds columns; a guided copy-paste from v1, where that hook did not exist yet.

Uploads do not fail in the meantime. If a column the build expects is missing, the upload retries without it rather than rejecting the whole batch — those columns are informational, since encrypted rows are recognised by their payload shape rather than by a flag.

### Adding friends

Two routes. **By handle** sends a request the other person approves. **By invite code** goes the other way: you generate a single-use code, hand it over through any channel you like, and redeeming it completes the link in one step — holding the code *is* the consent, so there is no second approval to chase. Codes expire after 14 days and can be revoked.

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
