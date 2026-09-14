# Local database operation

The browser uses the Express API for all shared data. Express owns the SQLite file;
Firebase hosts only the frontend. Browser localStorage remains the existing draft
and session cache, so unsaved drafts still stay on the device until saved.

## Start locally

Run commands from this project directory. The installed dependencies were tested
with Node 25.7.0. Use a supported Node version compatible with better-sqlite3 12
and jsdom 29; Node 24 LTS is also within their declared engine ranges.

```powershell
npm ci
Copy-Item .env.example .env
npm run import-db
npm start
```

Copy `.env.example` only when `.env` does not already exist. Open
`http://localhost:3001` for the application and
`http://localhost:3001/api/health` for `{ "ok": true, "database": "sqlite" }`.
The default listener is loopback-only, with authentication optional for local
development. Do not change the listener to a network interface without credentials.

## Database and imports

Default database: `server/settlement.db`, currently
`D:\XAMPP\htdocs\Sett\settelment\server\settlement.db`.
`DB_PATH` overrides it; relative paths are resolved from the working directory.
WAL, foreign keys and a 5000 ms busy timeout are enabled.

The default import reads all six `*_rows.csv` files from `Bashar Data base`.
Imported counts: car_makes 108, car_models 374, colors 34,
registration_types 8, parts 391, sessions 331.
The older `data con` export is incomplete and does not have all required IDs;
it is deliberately not merged with the complete export.

```powershell
npm run import-db
npm run import-db -- "D:\path\to\complete-export"
```

The importer accepts `<table>_rows.csv` or `<table>.csv`, checks actual headers,
requires every table, preserves IDs and session JSON, and imports in one transaction.
Invalid input or foreign keys fail the import. Existing primary keys are skipped,
so re-importing does not overwrite later local edits. Deleted original export rows
will be restored on re-import. This is an import command, not a bidirectional sync.

Before importing it makes a SQLite online backup next to the destination, named
`settlement.db.backup-<timestamp>`. If `server/sessions.db` exists, it also backs
that file up and imports missing legacy sessions before CSV sessions. Existing
destination rows win, then legacy sessions, then CSV rows. Source files are retained.
No legacy sessions database was present in this workspace.

To make an additional consistent backup while the backend is running:

```powershell
node -e "require('dotenv').config(); const s=require('./server/db'); s.db.backup(s.databasePath+'.backup-'+Date.now()).then(()=>s.db.close()).catch(e=>{console.error(e);process.exitCode=1;s.db.close()})"
```

Keep copies on a separate protected disk. Restore with the backend stopped, keeping
the current database and its WAL/SHM files as a separate backup first. Do not copy
only a live `.db` file while ignoring pending WAL data.

## API

All data endpoints are under `/api`:

| Resource | Read | Create | Update | Delete |
|---|---|---|---|---|
| car_makes, car_models, colors, registration_types, parts | GET /api/<table> | POST /api/<table> | PUT /api/<table>/<id> | DELETE /api/<table>/<id> |
| sessions | GET /api/sessions | POST /api/sessions/upsert | POST /api/sessions/upsert | POST /api/sessions/delete |

Lookup reads return arrays. Creates and updates return `[record]` to preserve
frontend expectations. Repeated creates with the same name (and make for a model)
return the existing record. IDs are generated for new values. Sessions retain the
existing object keyed by case number. Session upsert takes
`{caseNum, title, state, updatedAt}`; delete takes `{caseNum}`.
`GET /api/sessions/stream` delivers upsert/delete events and heartbeat comments.
The existing frontend polling and manual-save behavior remain in place.

## Verification

```powershell
npm test
Invoke-RestMethod http://localhost:3001/api/health
Invoke-RestMethod http://localhost:3001/api/colors
```

Tests use a separate temporary SQLite database: import counts, Arabic preservation,
repeat imports, invalid headers, integrity/foreign keys, lookup CRUD, session CRUD,
SSE, authentication, CORS, private-file protection, and frontend reads/writes in a
DOM harness. A live visual browser check was unavailable because no browser was
connected to the automation tool.

For a manual check, select makes/models/colors, create a temporary lookup value,
save a temporary case, reload and reopen it, edit/save it, and delete it. Open two
tabs to check session synchronization. DevTools Network should show data requests
only to the configured API. Failed requests appear in the existing sync status.

## Later: Firebase and an HTTPS tunnel

1. Set `AUTH_USER` and a strong unique `AUTH_PASSWORD` in the server's `.env`, then
   set `NODE_ENV=production`. The server refuses production startup without them.
2. Restrict `CORS_ORIGINS` to the actual frontend origins. `.env.example` includes
   this project's existing Firebase origins; remove any unused origins in production.
3. Keep `HOST=127.0.0.1`. Run the tunnel on the same computer, forwarding its HTTPS
   address to `http://127.0.0.1:3001`. No router port forwarding is needed.
4. Set `API_BASE_URL` in `js/config.js` to the tunnel's HTTPS base URL, with no `/api`
   suffix. That one setting controls lookup, session and SSE requests.
5. Redeploy the frontend to Firebase so both the updated JavaScript and tightened
   hosting exclusions take effect. No deployment or tunnel was performed here.
6. Open `https://<your-api-host>/api/login` and sign in using the browser's HTTP
   authentication dialog; then return to the frontend and reload. Fetch and SSE
   include browser credentials. Verify this flow in the target browser, particularly
   with cross-site privacy restrictions; use a common site/custom frontend domain
   or serve the frontend through Express if the browser blocks cross-site credentials.

Never serve authenticated traffic over plain HTTP outside loopback. CORS is an
origin restriction, not authentication. There are no embedded frontend credentials.
The shared login gives all authenticated users full database access; add individual
identity/access controls if that is not appropriate. Apply login rate limiting at
the tunnel/reverse proxy before public exposure. The server and computer must stay
running for remote access. The deployed HTTPS site cannot use another computer's
localhost database; it needs the configured reachable HTTPS API.

SQLite files, backups, CSV exports, `.env`, repository metadata and server files are
excluded from hosting. The previous Firebase configuration could publish the full
export directory; review the currently deployed hosting contents and redeploy the
updated exclusions before relying on them. Rotate any old exposed keys in the
services where they were issued. Git history is not rewritten by this migration.
