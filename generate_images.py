from __future__ import annotations

import argparse
from pathlib import Path

from helpers.common import load_song_cards_from_json
from helpers.image_gen import create_song_cards_batch


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate song card images from JSON")
    parser.add_argument("--input", default="song-cards.json", help="Input JSON file path")
    parser.add_argument("--output-dir", default="output/cards", help="Directory for generated images")
    parser.add_argument(
        "--template",
        default=str(Path("templates") / "song-card-template.svg"),
        help="SVG template path",
    )
    parser.add_argument(
        "--image-width-px",
        type=int,
        default=1600,
        help="Output image width in px (height is half)",
    )
    args = parser.parse_args()

    songs = load_song_cards_from_json(args.input)
    generated = create_song_cards_batch(
        songs,
        args.output_dir,
        template_path=args.template,
        image_width_px=args.image_width_px,
    )
    print(f"Generated {len(generated)} images in {args.output_dir}")


if __name__ == "__main__":
    main()
