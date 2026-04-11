# AGENTS.md

Scope: applies to `freakster-web-svelte/`.

## Project-specific rules

- Use the **server implementations** for production flow:
  - `src/lib/server/spotify.ts`
  - `src/lib/server/musicbrainz.ts`
  - `src/lib/server/card-render.ts`
  - `src/lib/server/pdf.ts`
- `src/lib/*.ts` contains older browser-side variants; do not wire new API route logic to those files.

## API and integration gotchas

- Spotify playlist tracks must be fetched from `/v1/playlists/{id}/items` (not `/tracks`) to avoid false 403 behavior seen in this project.
- Spotify page size is capped at `50`; keep `SPOTIFY_PLAYLIST_PAGE_LIMIT = 50`.
- Spotify auth route intentionally forces account picker (`show_dialog=true`) to avoid sticky-session account mismatch.
- MusicBrainz requests must include a real `User-Agent` header; missing it can cause HTTP 403.

## PDF/card layout constraints

- Current print target is A4 landscape with exactly 3 cards across full width.
- Keep `cardSideMm: 49.5` in `src/routes/api/generate-pdf/+server.ts` (card width = `2 * cardSideMm = 99mm`; `3 * 99mm = 297mm`).

## Environment assumptions

- Required env vars are server-side only:
  - `SPOTIFY_CLIENT_ID`
  - `SPOTIFY_CLIENT_SECRET`
  - `SPOTIFY_REDIRECT_URI`
- Callback path must match `/auth/spotify/callback`.
