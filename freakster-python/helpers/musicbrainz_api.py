import musicbrainzngs
import re


def configure_musicbrainz(
    app_name: str = "freakster",
    app_version: str = "0.1.0",
    contact: str | None = None,
) -> None:
    musicbrainzngs.set_useragent(app_name, app_version, contact)
    musicbrainzngs.set_rate_limit(limit_or_interval=1.0, new_requests=1)


def find_first_release_date_by_isrc(isrc: str | None) -> str | None:
    if not isrc:
        return None

    result = musicbrainzngs.get_recordings_by_isrc(isrc, includes=["releases"])
    recordings = (result.get("isrc") or {}).get("recording-list", [])
    if not recordings:
        return None

    for recording in recordings:
        date = recording.get("first-release-date")
        if date and re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            return date

    candidate_dates: list[str] = []
    for recording in recordings:
        for release in recording.get("release-list", []):
            date = release.get("date")
            if date and re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
                candidate_dates.append(date)

    if not candidate_dates:
        return None

    return min(candidate_dates)
