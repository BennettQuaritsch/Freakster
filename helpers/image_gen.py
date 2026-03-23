from __future__ import annotations

from pathlib import Path
from typing import Union

from PIL import Image, ImageDraw, ImageFont
import qrcode

from helpers.common import SongCardData, normalize_release_date, slugify_filename


def build_qr_image(spotify_url: str, size_px: int = 360) -> Image.Image:
    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(spotify_url)
    qr.make(fit=True)
    qr_image = qr.make_image(fill_color="black", back_color="white")
    image = qr_image.get_image().convert("RGB")
    return image.resize((size_px, size_px), Image.Resampling.NEAREST)


def _load_font(size: int) -> Union[ImageFont.FreeTypeFont, ImageFont.ImageFont]:
    for name in ("DejaVuSans.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def create_song_card(song: SongCardData, output_path: str, card_size: int = 800) -> None:
    card = Image.new("RGB", (card_size, card_size), color=(247, 247, 247))
    draw = ImageDraw.Draw(card)

    split_x = card_size // 2
    draw.rectangle((split_x, 0, card_size, card_size), fill=(255, 255, 255))
    draw.line((split_x, 40, split_x, card_size - 40), fill=(220, 220, 220), width=3)

    qr_size = int(card_size * 0.38)
    qr_img = build_qr_image(song.spotify_url, size_px=qr_size)
    qr_x = (split_x - qr_size) // 2
    qr_y = (card_size - qr_size) // 2
    card.paste(qr_img, (qr_x, qr_y))

    title_font = _load_font(40)
    body_font = _load_font(30)
    small_font = _load_font(26)

    text_x = split_x + 36
    y = 80

    draw.text((text_x, y), "Artist", fill=(100, 100, 100), font=small_font)
    y += 36
    draw.multiline_text((text_x, y), song.artist_name, fill=(20, 20, 20), font=body_font, spacing=6)

    y += 140
    draw.text((text_x, y), "Song", fill=(100, 100, 100), font=small_font)
    y += 36
    draw.multiline_text((text_x, y), song.song_name, fill=(20, 20, 20), font=title_font, spacing=6)

    y += 180
    draw.text((text_x, y), "Release Date", fill=(100, 100, 100), font=small_font)
    y += 36
    draw.text(
        (text_x, y),
        normalize_release_date(song.release_date),
        fill=(20, 20, 20),
        font=body_font,
    )

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    card.save(output_path)


def create_song_cards_batch(songs: list[SongCardData], output_dir: str) -> list[str]:
    output_root = Path(output_dir)
    output_root.mkdir(parents=True, exist_ok=True)

    generated: list[str] = []
    for index, song in enumerate(songs, start=1):
        file_name = f"{index:03d}_{slugify_filename(song.artist_name)}_{slugify_filename(song.song_name)}.png"
        target = output_root / file_name
        create_song_card(song, str(target))
        generated.append(str(target))

    return generated
