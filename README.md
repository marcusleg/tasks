# Tasks

A minimalist, self-hosted task manager in the spirit of Google Tasks. Each User keeps private Lists of Tasks, signs in through an OIDC provider, and can subscribe to their dated Tasks from an external calendar. See [`CONTEXT.md`](CONTEXT.md) for the domain language and [`docs/adr/`](docs/adr/) for the architectural decisions.

Built with SvelteKit (Svelte 5, TypeScript) on the Node adapter, with SQLite through Drizzle ORM.

## Local development

Requires Node 24 and npm.

```sh
npm install
npm run dev
```

The dev server runs on <http://localhost:5173>. The SQLite database is created at `./data/tasks.db` on first start and migrated automatically.

To run the end-to-end tests you need a Playwright browser once:

```sh
npx playwright install chromium
```

### Scripts

| Script                | What it does                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run dev`         | Start the Vite dev server.                                                                         |
| `npm run build`       | Build the production server into `build/`.                                                         |
| `npm start`           | Run the production build (`node build`).                                                           |
| `npm test`            | Run the unit tests (Vitest) once. `npm run test:watch` keeps them running.                         |
| `npm run test:e2e`    | Build the app, start the production server on port 4173 with a throwaway database, run Playwright. |
| `npm run lint`        | Check formatting (Prettier) and lint (ESLint).                                                     |
| `npm run format`      | Format everything with Prettier.                                                                   |
| `npm run check`       | Type-check with `svelte-check`.                                                                    |
| `npm run db:generate` | Generate a new migration in `drizzle/` from `src/lib/server/db/schema.ts`.                         |
| `npm run db:studio`   | Open Drizzle Studio against the local database.                                                    |

### Database migrations

The schema lives in `src/lib/server/db/schema.ts`. After changing it, run `npm run db:generate` and commit the generated files in `drizzle/`. The server applies pending migrations when it starts (from the `init` hook in `src/hooks.server.ts`), so there is no separate migrate step. Migrations are read from `./drizzle` relative to the working directory, so start the server from the project root.

## Running the container

```sh
docker build -t tasks .
docker run -p 3000:3000 -v tasks-data:/data tasks
```

The image runs as the unprivileged `node` user (uid 1000), listens on port 3000 and keeps its database in the `/data` volume. If you bind-mount a host directory instead of a named volume, it must be writable by uid 1000. `GET /healthz` returns `{"status":"ok"}` with status 200 when the server is up and the database is reachable, and 503 otherwise.

## Environment variables

| Variable        | Default                                                  | Purpose                                                                                                                                                                 |
| --------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH` | `./data/tasks.db` in dev, `/data/tasks.db` in production | Path to the SQLite database file. Its directory is created if missing.                                                                                                  |
| `PORT`          | `3000`                                                   | Port the production server listens on (adapter-node).                                                                                                                   |
| `ORIGIN`        | unset                                                    | Reserved for the public URL of the app (for example `https://tasks.example.com`), used by the OIDC login to build its redirect URL. Not read by the app yet; see below. |

SvelteKit 3's Node adapter no longer reads `ORIGIN` itself: it derives the origin of each request from the `Host` header and the connection. Behind a TLS-terminating reverse proxy, tell it which headers to trust so the origin comes out as `https://…`:

```sh
PROTOCOL_HEADER=x-forwarded-proto
HOST_HEADER=x-forwarded-host
```

The other adapter-node variables (`HOST`, `BODY_SIZE_LIMIT`, `SHUTDOWN_TIMEOUT`, …) are documented in the [adapter-node docs](https://svelte.dev/docs/kit/adapter-node).
