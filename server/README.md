# StreamBooru Sync Server

Account sync API for StreamBooru (favorites, site profiles, Discord OAuth, image proxy).

Runtime: **Bun** (v0.2.0+). Database: **PostgreSQL**.

## Coolify deployment

1. Create a new application in Coolify pointing at this repo.
2. Set **Base Directory** to `/` (repository root — **not** `server`).
3. Nixpacks uses the root `nixpacks.toml`: installs Bun deps in `server/`, copies `renderer/` → `server/webapp/` at build time, then runs migrations and starts the API.
4. Add a PostgreSQL database (Coolify plugin or external) and set environment variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | Long random string for auth tokens |
| `ENC_SECRET` | yes | Long random string for encrypting stored site credentials |
| `BASE_URL` | yes | Public HTTPS URL, e.g. `https://streambooru.ecchibooru.uk` |
| `PORT` | no | Default `3000` (Coolify usually injects this) |
| `HOST` | no | Default `0.0.0.0` |
| `TRUST_PROXY` | no | Express proxy trust rule; defaults to loopback/private proxy networks |
| `PGSSL` | no | Set `true` if Postgres requires SSL |
| `DISCORD_CLIENT_ID` | no | For Discord login/link |
| `DISCORD_CLIENT_SECRET` | no | For Discord login/link |
| `MAX_MEDIA_BYTES` | no | Maximum streamed media response, default 512 MiB |
| `MAX_API_PROXY_BYTES` | no | Maximum buffered API proxy response, default 10 MiB |

Production startup refuses the built-in development value for `JWT_SECRET`. Proxy routes also enforce per-client rate/concurrency limits, validate every redirect target, and never log credential-bearing query strings.

5. Deploy. On each start, `start:prod` runs SQL migrations then starts the API.

Health check path: `/health`

Public routes:

| Path | Description |
|------|-------------|
| `/` | Landing page |
| `/app/` | Web-based StreamBooru browser (renderer copied at build time) |
| `/oauth-callback` | Discord OAuth return page for web login |

Discord OAuth redirect URI (if using Discord):  
`{BASE_URL}/auth/discord/callback`

For web login, add this redirect in the Discord app settings (optional, used as `redirect_uri` in OAuth state):  
`{BASE_URL}/oauth-callback`

## Local development

```bash
cd server
cp .env.example .env   # edit DATABASE_URL and secrets
bun install
bun run migrate
bun run start
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run start` | Start API only |
| `bun run migrate` | Apply pending SQL migrations |
| `bun run start:prod` | Migrate then start (used by Coolify) |

Repository-level smoke tests use an isolated local server and do not require a deployed instance:

```bash
npm run test:server
```

Use `npm run test:server:deployed` only when intentionally checking the public deployment.
