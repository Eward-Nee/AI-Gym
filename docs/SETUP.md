# AI-Gym — Supabase setup

There are **two** Supabase projects in this design, and they do different jobs.

| | Project | Who runs it | What it holds |
|---|---|---|---|
| **Hub** | `uuljnonlnobsxfutruqq` (the one you created) | you, once, for everybody | accounts, handles, friendships, and each user's *pointer* to their own project |
| **Personal** | one per user, created by that user | each user, for themselves | that user's exercises, workouts and full training history |

The hub never stores training data. It stores **where** a friend's data lives and **whether you are allowed to read it**.

---

## Part 1 — The hub (do this once)

> Run this in the project you already created: `https://uuljnonlnobsxfutruqq.supabase.co`

1. Open <https://supabase.com/dashboard/project/uuljnonlnobsxfutruqq/sql/new>
2. Open [`sql/hub-schema.sql`](../sql/hub-schema.sql) from this folder, copy the whole file.
3. Paste it into the SQL editor and press **Run**.
4. You should see `AI-Gym hub schema installed.`

Then turn on email sign-up:

5. Go to **Authentication → Providers → Email** and make sure it is enabled.
6. While testing, **Authentication → Providers → Email → "Confirm email"** is easier turned **off** — otherwise every test account needs a mailbox round-trip. Turn it back on before you share the app with anyone.

That is the entire hub setup. The app already ships pointing at this project — the URL and publishable key are in [`js/sync.js`](../js/sync.js) under `HUB_DEFAULT`, and both are safe to ship in a client (all the real protection is in the row-level security policies you just installed).

### What the hub schema creates

- `profiles` — one row per account. Handle, display name, current rank. Any signed-in user can read these; that is how you find someone to add.
- `connections` — each account's personal project URL + publishable key. **Private.** Only the owner can select it directly. Friends get it through `get_friend_connection()`, which checks the friendship first and refuses otherwise.
- `friendships` — requests and accepted links, with policies so only the two parties involved can see or change a row.
- `shared_stats` — a small cached roll-up (rank, volume, muscle split, top lifts) so the VS screen renders instantly without opening a second connection.
- `hub_keepalive` + `hub_keepalive()` — the once-per-day heartbeat, described below.
- A trigger that creates a profile automatically on sign-up, deriving a handle from the email local part and de-duplicating if it is taken.

---

## Part 2 — A personal project (each user does this for themselves)

This is fully guided inside the app, so you normally never touch this file. **Control Panel → Your Supabase project** walks through it:

1. **Create a free Supabase project.** One per person.
2. **Run the setup SQL.** The app shows the whole of [`sql/user-schema.sql`](../sql/user-schema.sql) inline with a **Copy** button, and a **Download** button if you would rather open it in the SQL editor from a file. Paste → Run.
3. **Paste the project URL and publishable key** (Project Settings → API).
4. **Press "Test connection".** This:
   - calls `gym_ping()` to confirm the project is reachable and the schema is installed,
   - claims the one-time write key (see below) and stores it on this device,
   - reports each step pass/fail with the specific reason if something is wrong.
5. **Press "Upload N records"** — this is the auto-fill step. Everything already in local storage (exercises, workouts, every logged session) is upserted into the new tables in chunks of 200.

If step 4 fails, the app tells you which step failed and why; the most common cause by far is the SQL not having been run yet in that project.

### Why there is no fully-automatic mode

The app cannot create your tables for you, and no client-side app can. Creating tables is DDL, and DDL needs either the Postgres connection string or a Management API personal access token — both are full-control credentials. Shipping an app that asks users to paste one of those into a web page would be teaching a habit that gets people's databases taken over, and the app has no server to hold such a credential safely.

So the split is: **you** run one SQL script once (30 seconds, copy-paste), and **the app** does everything after that automatically — verification, write-key claim, first upload, and all ongoing sync. That is the "manual copy-paste and test mode" from the brief, with the auto-fill wired to the test passing.

### The write key — why your data is safe even though friends hold your key

Friends need to read your project, so they get your publishable key. On its own that key would also let them *write*, which is not acceptable.

The user schema closes that:

- `SELECT` is open to the publishable key — that is what makes sharing work.
- `INSERT` / `UPDATE` / `DELETE` additionally require a secret write key, sent as an `x-gym-write-key` header and checked by `gym_has_write_access()`.
- `gym_claim_write_key()` returns that key **exactly once**. Your app claims it during "Test connection" and stores it locally. Every later call raises, so a leaked read key can never be escalated into write access afterwards.
- Lost a device? `gym_rotate_write_key()` issues a new one, but only to a caller that already holds the current key.

Net effect: a friend can read everything you train and change nothing.

---

## Part 2b — Re-running the hub schema

If the Friends section shows an error mentioning a missing function, the hub is running an older schema than this build expects. Re-run [`sql/hub-schema.sql`](../sql/hub-schema.sql).

Worth knowing why a previous re-run may have looked fine but silently failed: Postgres refuses to change a function's return type through `CREATE OR REPLACE` ("cannot change return type of existing function"). Any statement that tried to widen an existing function errored, the rest of the script carried on, and the old function stayed in place — so the app kept calling something that no longer matched. The current file drops those functions before recreating them, so it is genuinely safe to re-run across versions.

A different error — one that mentions an expired session or JWT — is not a schema problem. Sign out and back in.

## Part 2c — Keeping the project schema up to date

The app declares which project schema version it needs. If yours is older, the Control Panel says so and the update check offers to fix it — uploads keep working in the meantime, just without the newer columns.

- **From schema v2 onward** the project can update itself. `gym_migrate()` is a `security definer` function that only ever *adds* columns — it cannot drop a column or a table, so a bug in a future client cannot be turned into data loss through it. It also issues `NOTIFY pgrst, 'reload schema'`, without which PostgREST keeps serving the cached table shape and the new columns stay invisible to the API.
- **From v1 there is no self-update**, because the hook did not exist yet. That first step is a copy-paste: the prompt gives you a direct link to *your* project's SQL editor, the full script with a Copy button, and a Re-check button. It is the last time it will be needed.

## Part 3 — The daily keep-alive

Supabase pauses free projects after a stretch of inactivity. (For the record: the free-tier behaviour is a **pause after about a week of inactivity**, and your data is retained — it is not the "tables deleted after a month" you were expecting. Either way a periodic write keeps the project awake, so the mechanism you asked for is the right one.)

On the first launch of each calendar day the app calls both keep-alives:

- **`gym_keepalive()`** on your personal project — deletes and re-inserts a heartbeat row inside one transaction and reports whether it ran. It touches a dedicated `gym_keepalive` table, never your training data, so a delete/insert cycle can never cost you a session.
- **`hub_keepalive()`** on the shared hub — same idea, but guarded **server-side** against `current_date` with a `FOR UPDATE` lock. Whoever opens the app first that day performs the write; everyone else that day gets `ran = false` and no write happens. Exactly one heartbeat per day for the whole app, no matter how many people use it, which is precisely the "2nd user load of day must not trigger this" rule from the brief.

The client also remembers the date it last ran so it does not even make the call twice from one device.

You can force a run and see the result any time under **Control Panel → Diagnostics → Run keep-alive now**.

---

## Security notes worth acting on

**Never share the database connection string.** `postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres` carries the full-control password for the project. It is not needed anywhere in this app and is not stored anywhere in this repo. If it has ever been pasted into a chat, an issue, or a screenshot, treat it as burned and reset it at **Project Settings → Database → Reset database password**. The publishable key is a different thing entirely and is safe to ship — it is designed to be public.

**What is safe to commit.** `HUB_DEFAULT` in `js/sync.js` (URL + publishable key) is meant to ship in the client. Never put a service-role key, a Management API token, or the database password anywhere in this repo.

**Email confirmation.** Turn it back on before real users sign up, otherwise anyone can register any address.
