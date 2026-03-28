from __future__ import annotations

import os

import spotipy
from dotenv import load_dotenv
from spotipy.exceptions import SpotifyException
from spotipy.oauth2 import SpotifyOAuth

from helpers.common import SongCardData, extract_playlist_id


def create_spotify_client() -> spotipy.Spotify:
    """Create a Spotipy client using Authorization Code Flow."""
    load_dotenv()

    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
    redirect_uri = os.getenv("SPOTIPY_REDIRECT_URI")

    if not client_id or not client_secret or not redirect_uri:
        raise ValueError(
            "Missing SPOTIPY_CLIENT_ID, SPOTIPY_CLIENT_SECRET, or SPOTIPY_REDIRECT_URI"
        )

    auth_manager = SpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        scope="playlist-read-private,playlist-read-collaborative",
    )
    return spotipy.Spotify(auth_manager=auth_manager)


def get_playlist_tracks(playlist_ref: str) -> list[SongCardData]:
    """Fetch all tracks from a playlist using playlist_items pagination."""
    sp = create_spotify_client()
    playlist_id = extract_playlist_id(playlist_ref)

    try:
        page = sp.playlist_items(
            playlist_id=playlist_id,
            limit=100,
            additional_types=("track",),
        )
    except SpotifyException as exc:
        if exc.http_status in (401, 403):
            raise PermissionError(
                "Spotify rejected playlist access. Ensure the authenticated user has access and granted required scopes."
            ) from exc
        raise

    songs: list[SongCardData] = []

    while page:
        for item in page.get("items", []):
            track = None
            if item:
                track = item.get("track") or item.get("item")
            if not track:
                continue
            if track.get("type") != "track":
                continue

            artist_names = [
                a.get("name", "")
                for a in track.get("artists", [])
                if a and a.get("name")
            ]
            artist_name = ", ".join(artist_names) if artist_names else "Unknown Artist"
            song_name = track.get("name") or "Unknown Song"
            spotify_url = (track.get("external_urls") or {}).get("spotify")
            isrc = (track.get("external_ids") or {}).get("isrc")
            if not spotify_url:
                track_id = track.get("id")
                spotify_url = (
                    f"https://open.spotify.com/track/{track_id}" if track_id else ""
                )

            songs.append(
                SongCardData(
                    artist_name=artist_name,
                    song_name=song_name,
                    spotify_url=spotify_url,
                    isrc=isrc,
                )
            )

        page = sp.next(page) if page.get("next") else None

    return songs
