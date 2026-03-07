# @bluslate/web

Self-hosted web server for BluSlate. Serves a Svelte UI and exposes a Fastify HTTP + Socket.IO API for running the rename pipeline remotely — designed for Docker deployments but also runnable locally.

## Environment Variables

| Variable | Default (Docker) | Default (local) | Description |
|---|---|---|---|
| `PORT` | `3000` | `3000` | HTTP port to listen on |
| `TMDB_API_KEY` | — | — | TMDb API JWT bearer token (required) |
| `MEDIA_ROOT` | `/media` | `/media` | Root directory exposed to the file browser. Mount your media here. |
| `BLUSLATE_DATA` | `/data` | `~/.local/share/bluslate` | Directory for persistent data (settings, recent directories). |
| `BLUSLATE_PASSWORD` | — | — | If set, enables HTTP Basic Auth and Socket.IO token auth with this password. |
| `BLUSLATE_LANGUAGE` | `en-US` | `en-US` | TMDb language code for search results (e.g. `en-US`, `de-DE`). |
| `BLUSLATE_TEMPLATE` | — | — | Rename template override (e.g. `{show_name} - S{season}E{episode} - {episode_title}`). |
| `BLUSLATE_MIN_CONFIDENCE` | `85` | `85` | Minimum confidence score (0–100) for auto-approving matches. |

## Docker

```bash
docker run -d \
  -p 3000:3000 \
  -e TMDB_API_KEY=your_jwt_token \
  -v /path/to/media:/media \
  -v bluslate-data:/data \
  bluslate/web
```

Open `http://localhost:3000` in your browser.

## Running Locally (dev)

```bash
# Build core first, then start the web server with file watching
pnpm --filter @bluslate/core run build
TMDB_API_KEY=your_token \
MEDIA_ROOT=/Volumes/YourMedia \
pnpm --filter @bluslate/web run dev
```

`BLUSLATE_DATA` defaults to `~/.local/share/bluslate` when not set, so settings persist automatically without any additional configuration.

## Building for Production

```bash
pnpm --filter @bluslate/core run build
pnpm --filter @bluslate/web run build
node packages/web/dist/server/index.js
```
