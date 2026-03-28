from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
import re


@dataclass(slots=True)
class SongCardData:
    artist_name: str
    song_name: str
    spotify_url: str
    isrc: str | None = None
    release_date: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return {
            "song_name": self.song_name,
            "artist_name": self.artist_name,
            "spotify_url": self.spotify_url,
            "isrc": self.isrc,
            "release_date": self.release_date,
        }

    @classmethod
    def from_dict(cls, data: dict[str, str | None]) -> "SongCardData":
        return cls(
            song_name=(data.get("song_name") or "").strip(),
            artist_name=(data.get("artist_name") or "").strip(),
            spotify_url=(data.get("spotify_url") or "").strip(),
            isrc=(data.get("isrc") or None),
            release_date=(data.get("release_date") or None),
        )


def extract_playlist_id(playlist_ref: str) -> str:
    value = playlist_ref.strip()
    if not value:
        raise ValueError("Playlist reference is empty")

    if "spotify:playlist:" in value:
        return value.rsplit(":", 1)[-1]

    match = re.search(r"playlist/([A-Za-z0-9]+)", value)
    if match:
        return match.group(1)

    return value


def normalize_release_date(value: str | None) -> str:
    if not value:
        return "Unknown"
    return value.strip() or "Unknown"


def slugify_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return cleaned or "song"


def save_song_cards_to_json(songs: list[SongCardData], output_path: str) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [song.to_dict() for song in songs]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_song_cards_from_json(input_path: str) -> list[SongCardData]:
    path = Path(input_path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Expected a JSON list of songs")
    return [SongCardData.from_dict(item) for item in raw if isinstance(item, dict)]
