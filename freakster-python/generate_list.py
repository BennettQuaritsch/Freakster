from __future__ import annotations

import argparse

from helpers.common import save_song_cards_to_json
from helpers.musicbrainz_api import configure_musicbrainz, find_first_release_date_by_isrc
from helpers.spotify_api import get_playlist_tracks


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate song card JSON from a Spotify playlist")
    parser.add_argument("playlist", help="Spotify playlist URL, URI, or ID")
    parser.add_argument("--output", default="song-cards.json", help="Output JSON file path")
    parser.add_argument("--app-name", default="freakster", help="MusicBrainz app name")
    parser.add_argument("--app-version", default="0.1.0", help="MusicBrainz app version")
    parser.add_argument("--contact", default=None, help="MusicBrainz contact URL/email")
    args = parser.parse_args()

    songs = get_playlist_tracks(args.playlist)
    configure_musicbrainz(args.app_name, args.app_version, args.contact)

    for song in songs:
        try:
            song.release_date = find_first_release_date_by_isrc(song.isrc)
        except Exception:
            song.release_date = None

    save_song_cards_to_json(songs, args.output)
    print(f"Saved {len(songs)} songs to {args.output}")


if __name__ == "__main__":
    main()
