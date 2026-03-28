# Freakster - Create your own Hitster

Generate Hitster-like song cards from a Spotify playlist.

## Python Scripts for Card generation

### Setup

1. Create and activate a virtual environment.
2. Install dependencies:

`pip install -r requirements.txt`

3. Create `.env` from `.env.template`.
4. Create a Spotify app, then set client id/secret and redirect URL in `.env`.

### List generation

Generate track metadata JSON from a playlist:

`python generate_list.py --playlist <spotify_playlist_url_or_id> --output song-cards.json`

### Image generation

Generate foldable 2:1 card PNGs from the SVG template:

`python generate_images.py --input song-cards.json --output-dir output/cards --template templates/song-card-template.svg --image-width-px 1600`

- Output ratio is `2:1` (front + back in one image).
- Artist/date/song are centered and wrapped automatically.

### PDF generation

Pack card PNGs into an A4 PDF for printing:

`python generate_pdf.py --input-dir output/cards --output output/cards-a4.pdf --card-side-mm 60 --margin-mm 0 --gap-mm 0 --orientation landscape`

- `--card-side-mm` is the folded card side length.
- Printed card size is `2 * card-side-mm` by `card-side-mm`.

## iOS app for playing

### Setup

Setup the `Config.xcconfig` file with the appropriate data.

### Run the app

Run the app using xCode. Click on the dot in the upper-right corner. This should navigate to the spotify app, where ou can authenticate the app. Then just scan the QR codes.
