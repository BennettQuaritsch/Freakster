# Agents.md

This project is combination of python scripts. It aims to get the tracks from a spotify playlist, find its first release date and create a list of tracks with their release dates. Then this list can be utilized to generate cards with the song's spotify link as QR code in the front and the song's title, artist and release date in the back.

## freakster-python

### Main scripts

- `generate_list.py` -> generate list of tracks with their song URLs and release dates
- `generate_images.py` -> use the generated list to generate the cards of songs

### Structure

- Main scripts in root
- Helper functions in `helpers` folder
  - `common.py` -> common helpers
  - `image_gen.py` -> helpers for card and QR code generation
  - `musicbrainz_api.py` -> helpers regarding release date gathering
  - `spotify_api.py` -> helpers for getting playlist info
- `.env` for spotify credentials
- `requirements.txt`

#### Standard output
- `output/cards` folder for the output of the `generate_images.py`
- `song-cards.json` as output of `generate_list.py`

### APIs
- Spotify -> gather playlist and tracks, uses `spotipy` library
- Musicbrainz -> Get release date, uses `musicbrainzngs` library

### FAQ
- Musicbrainz API uses Spotify isrc for getting the specific matching recordings
- Musicbrainz helper filter all possible recording release dates for having a full date and then takes the earliest

## freakster-ios

The SwiftUI iOS app, which scans the generated QR codes and then plays the song automatically.
