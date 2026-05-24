# Freakster Web

SvelteKit app that turns a Spotify playlist into printable, foldable song cards — QR code on the front, artist / title / first release date on the back, ready to print on A4 (3 cards across, landscape).

## Flow

1. Sign in with Spotify.
2. Paste a playlist URL.
3. Review and edit the parsed tracks.
4. Export a print-ready PDF.

## Environment

Create a `.env` next to `package.json`:

```sh
SPOTIFY_CLIENT_ID=your_spotify_app_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_app_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:5173/auth/spotify/callback
```

The same redirect URI must be registered in your Spotify app settings.

## Run locally

```sh
bun install
bun run dev
```

Then open `http://localhost:5173`. `npm` works too if you prefer it.

## Build

```sh
bun run build
bun run preview
```

Uses `@sveltejs/adapter-node` — the build output is a Node server in `build/`.
