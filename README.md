# Campus LMS

> Dukumeentiyada Af-Soomaaliga: [Hordhac loogu diyaariyo slides](HORDHAC_NIDAAMKA.md) · [Dukumeenti farsamo oo buuxa](SYSTEM_DOCUMENTATION.md).

Campus LMS is a role-based university learning management system. The React client provides administrator, teacher, and student workspaces. The Express API stores academic records and user activity in MongoDB.

## Technology

- React 18, Vite 6, React Router, Tailwind CSS v4, Lucide React, Recharts
- Node.js with Express 4, Mongoose, MongoDB, JWT session cookies, and bcrypt
- JavaScript and JSX throughout

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+
- MongoDB 6.0+ (local or managed)

## Install and configure

From the project root, install dependencies and create a private server environment file:

```powershell
npm install
Copy-Item server/.env.example server/.env
```

Edit `server/.env`. Set a unique `JWT_SECRET` with at least 32 characters, the MongoDB connection URI, the frontend origin, and initial administrator credentials. Do not commit `server/.env`; it is ignored by Git. `server/.env.example` contains placeholders only.

For local development the sample values use MongoDB at `127.0.0.1:27017`, API port `5001`, and client origin `http://localhost:5173`. Start MongoDB before running the application. Create the first administrator once:

```powershell
npm run seed:admin
```

The seed command creates an administrator only when one with the configured email does not already exist. It does not reset an existing account.

## Run locally

```powershell
npm run dev
```

The client runs at `http://localhost:5173`; the API runs at `http://localhost:5001`. Vite proxies `/api` to the API. Student registration is self-service and signs the new student in immediately.

Useful commands:

```powershell
npm run dev:client
npm run dev:server
npm test
npm run build
npm start
```

`npm start` starts only the API. The client production build is written to `client/dist`.

## Modules

- **Administration:** dashboard totals, academic structure, teacher and student accounts, role/status controls, teacher class assignment, analytics, and report exports.
- **Teaching:** assigned classes and rosters, lessons and private materials, assignments and attachments, submissions and grading, quizzes, results release, and class analytics.
- **Student learning:** immediate self-registration, own-class lessons and assignments, PDF submissions, timed quizzes, grades and feedback, notifications, and teacher messaging.
- **Communication:** private notifications, Server-Sent Events, and class-authorized conversations.
- **Operations:** validated system settings, immutable audit history with filtered CSV export, and Admin-only system health.

Students are not enrolled by an administrator. There is no enrollment module or administrator approval step for student self-registration.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Use `development` locally and `production` for a production API. |
| `PORT` | API listening port; defaults to `5000` if omitted. |
| `MONGODB_URI` | MongoDB connection URI. Required for the API to persist data. |
| `JWT_SECRET` | Private signing key, at least 32 characters. Never put this in client variables. |
| `JWT_EXPIRES_IN` | JWT lifetime such as `12h` or `1d`; production allows at most 7 days. |
| `CLIENT_URL` | Frontend origin allowed to use cookie-authenticated API calls. Production requires HTTPS. Multiple origins can be comma separated. |
| `CLIENT_ORIGIN` | Optional additional trusted frontend origin(s), comma separated. |
| `TRUST_PROXY` | Set to `1` only when one trusted reverse proxy sits in front of Express. |
| `ASSIGNMENT_MAX_FILE_SIZE` | Maximum PDF submission bytes; default 10 MiB, hard cap 100 MiB. |
| `ASSIGNMENT_ATTACHMENT_MAX_FILE_SIZE` | Maximum assignment attachment bytes; default 15 MiB, hard cap 100 MiB. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Initial administrator details used by `npm run seed:admin`; use a unique password of at least 12 characters. |
| `MONGODB_TEST_URI` | Optional isolated MongoDB URI for database integration tests. The suite creates a uniquely named test database and drops that test database when finished. |

The client uses the same-origin `/api` path. For a separate frontend and API host, configure the hosting layer to proxy `/api` to Express and serve the client build with SPA fallback. That keeps authentication cookies same-site. Do not expose MongoDB or upload directories directly to the public web server.

## Production preparation and deployment

No deployment host or production database is configured in this project workspace, so deployment has not been performed. Prepare a host with persistent storage for MongoDB and `server/uploads`, install Node.js, and place the client and API behind HTTPS on one public origin. Serve `client/dist` as the frontend and reverse-proxy `/api` to the Node process. Configure the proxy to pass the original host and protocol. Set `TRUST_PROXY=1` only when Express is directly behind one trusted proxy.

Set these production variables in the hosting provider's secret/environment settings (not in source control):

```text
NODE_ENV=production
PORT=5001
MONGODB_URI=<private MongoDB URI>
JWT_SECRET=<unique random value, 32+ characters>
JWT_EXPIRES_IN=12h
CLIENT_URL=https://<your-frontend-host>
TRUST_PROXY=1
```

Production startup now fails early when the MongoDB URI, strong JWT secret, or HTTPS client origin is missing or invalid. It also refuses to serve the application if MongoDB cannot connect. The HTTP-only session cookie uses `Secure` in production. Keep MongoDB credentials and signing secrets only in the deployment environment.

Build and start:

```powershell
npm ci --include=dev
npm run build
npm run seed:admin
npm start
```

Run the seed command only after setting the initial admin values securely. The production server requires `NODE_ENV=production`; Vite's relative API path assumes the reverse proxy described above.

### MongoDB backup and restore

Install MongoDB Database Tools on a trusted operations machine. Back up the database on a schedule to encrypted storage with access controls and off-site retention. Example PowerShell commands (replace the database name and keep the URI private):

```powershell
$backupDir = Join-Path 'D:\LmsBackups' (Get-Date -Format 'yyyyMMdd-HHmmss')
mongodump --uri="$env:MONGODB_URI" --db=university_lms --out="$backupDir"
```

Back up `server/uploads` separately on the same schedule because database records reference those private files. Keep database and file backups access-controlled, encrypted, and time-aligned.

To validate a backup, restore it to a separate preview database first. Substitute the actual source database name in `--nsFrom`:

```powershell
mongorestore --uri="$env:RESTORE_URI" --nsFrom='university_lms.*' --nsTo='lms_restore_preview.*' "$backupDir\university_lms"
```

Verify users, academic relationships, and recent records in the preview database before planning a controlled recovery. Keep the current production database intact until restoration has been checked and an authorized cutover is scheduled. Never use destructive restore flags against the live database as a routine test.

## API overview

- `/api/auth/*`: login, logout, current session, and immediate student registration.
- `/api/academic/options`: active academic references used during registration.
- `/api/admin/*`, `/api/faculties`, `/api/departments`, `/api/classes`, `/api/teachers`, `/api/students`: administrator-only management and analytics.
- `/api/teacher/*`, `/api/student/*`, `/api/lessons/*`: class-scoped teaching and learning workflows.
- `/api/notifications/*`, `/api/conversations/*`: private notifications and authorized messages.
- `/api/reports/*`: role-scoped analytics and report exports.
- `GET /api/admin/settings`, `PUT /api/admin/settings`: Admin-only system settings.
- `GET /api/admin/audit-logs`, `GET /api/admin/audit-logs/:id`, `GET /api/admin/audit-logs/export`: Admin-only filtered audit records and CSV export.
- `GET /api/admin/system-health`: Admin-only operational status.
- `GET /api/health`: minimal public API and MongoDB status for availability checks.

Uploaded assignment and lesson files are stored under `server/uploads` and delivered through authenticated, ownership-checked endpoints. Keep this directory on persistent private storage in production. `UPLOAD_DIR` is currently used by the system-health storage check; changing it alone does not move uploaded files.

## Testing and QA

Run backend unit and integration tests with:

```powershell
npm test
```

Database-backed integration tests require `MONGODB_TEST_URI`. Use a dedicated disposable test MongoDB account/database; tests create a unique database and remove that database after completion. Without that variable, those integration tests are skipped and only the database-independent checks run.

## Troubleshooting

- **MongoDB disconnected:** check that MongoDB is running and that `MONGODB_URI` points to the correct database. Production exits instead of starting with a disconnected database.
- **Session unavailable:** confirm `JWT_SECRET` is set and at least 32 characters, the browser uses HTTPS in production, and the frontend origin matches `CLIENT_URL` exactly.
- **CORS or CSRF rejection:** use the configured HTTPS frontend origin and proxy API calls through the same public origin. Check forwarded host/protocol and `TRUST_PROXY` when behind a reverse proxy.
- **Port already in use:** set `PORT` to a free port and update the reverse proxy or Vite API proxy for local development.
- **Uploads fail after deployment:** verify the persistent private `server/uploads` storage is writable and that the configured file size is within both system settings and the route's hard safety limit.
- **Integration tests are skipped:** set `MONGODB_TEST_URI` to an isolated test database before running `npm test`.

## Project layout

```text
client/src/        React routes, role workspaces, and shared UI
server/src/config/ Environment loading, production validation, and MongoDB connection
server/src/models/ Mongoose records and relationships
server/src/routes/ Express API routes and integration tests
server/src/controllers/ Request handlers
server/src/services/ Audit, settings, notifications, storage, and domain services
server/uploads/    Private persistent user and learning files (ignored by Git)
```
