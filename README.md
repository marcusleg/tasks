# Tasks — a self-hosted to-do app

A simple, fast task list you run on your own server: lists side by side, tasks with details,
due dates, repeating tasks, priorities, stars and subtasks, calendar links for your calendar app, a "Completed" section, drag-and-drop ordering, and light and dark
themes. Sign in with built-in accounts, an OIDC provider, or both.

## Run it with Docker (recommended)

```sh
cp .env.example .env        # then edit PUBLIC_URL (and OIDC settings if you want them)
docker compose up -d --build
```

Open `http://<your-server>:3000`. **The first account you create is yours**; after that, sign-up
is closed unless you set `ALLOW_SIGNUP=true`. Data lives in the `tasks-data` volume
(a single SQLite file, `/data/tasks.db`).

Without Compose:

```sh
docker build -t self-hosted-tasks .
docker run -d --name tasks -p 3000:3000 -v tasks-data:/data \
  -e PUBLIC_URL=https://tasks.example.com self-hosted-tasks
```

Podman works the same way (`podman build`, `podman run`).

## Run it without Docker

Needs Node.js 22.13 or newer (it uses Node's built-in SQLite, so nothing needs compiling).

```sh
npm ci
npm run build
PUBLIC_URL=http://localhost:3000 npm start
```

## Sign-in options

| What you want | Settings |
| --- | --- |
| Only built-in accounts (default) | nothing to set |
| Built-in accounts **and** single sign-on | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_PROVIDER_NAME` |
| Only single sign-on | the above plus `AUTH_PASSWORD_ENABLED=false` (and optionally `OIDC_AUTO_REDIRECT=true`) |

### Setting up OIDC

1. In your identity provider (Authentik, Keycloak, Authelia, Pocket ID, Zitadel, Google, Microsoft
   Entra ID …) create an OpenID Connect / OAuth2 application.
2. Set its redirect URI to `<PUBLIC_URL>/auth/oidc/callback`,
   e.g. `https://tasks.example.com/auth/oidc/callback`.
3. Put the issuer URL, client ID and secret into `.env`, then restart.

The app uses the authorization-code flow with PKCE, state and nonce checks. The first OIDC sign-in
creates an account (turn off with `OIDC_ALLOW_SIGNUP=false`), or attaches to an existing account
with the same *verified* email. Restrict access to certain groups with
`OIDC_ALLOWED_GROUPS=tasks-users` (the provider must send a `groups` claim; change the claim name
with `OIDC_GROUPS_CLAIM`).

## Calendar links

Each user can create secret calendar addresses (Calendar links) in the app. They publish that
user's open, dated tasks (from all lists or chosen ones) as an iCalendar feed at
`<PUBLIC_URL>/cal/<secret>.ics`; repeating tasks become repeating events. Set `PUBLIC_URL` to the
address calendar apps can reach, because the links are built from it.

## Behind a reverse proxy (HTTPS)

Point your proxy at port 3000, set `PUBLIC_URL=https://…` (cookies then become HTTPS-only) and
`TRUST_PROXY=true`. Example for Caddy:

```
tasks.example.com {
  reverse_proxy localhost:3000
}
```

## Admin commands

Run these where the app runs (with Docker: `docker compose exec tasks node server/cli.js …`):

```sh
node server/cli.js list-users
node server/cli.js reset-password alice          # prints a temporary password
node server/cli.js create-user bob@example.com   # prints a temporary password
node server/cli.js delete-user bob@example.com
```

## Backups

Everything is in one file: `/data/tasks.db` (plus `tasks.db-wal` while running). Back up the
volume, or run `sqlite3 /data/tasks.db ".backup backup.db"`.

## Security notes

- Passwords are hashed with scrypt; sign-in attempts are rate limited per IP and account.
- Sessions are random tokens stored hashed on the server, in `HttpOnly`, `SameSite=Lax` cookies.
- Every change request must carry a custom header and come from the app's own origin (CSRF guard),
  and pages are served with a strict Content-Security-Policy.

## All settings

See `.env.example` — every option is listed there with a short explanation.
