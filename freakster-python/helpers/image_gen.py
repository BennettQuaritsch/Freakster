from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Final
import xml.etree.ElementTree as ET

import cairosvg
import qrcode

from helpers.common import SongCardData, normalize_release_date, slugify_filename

SVG_NS: Final[str] = "http://www.w3.org/2000/svg"
XLINK_NS: Final[str] = "http://www.w3.org/1999/xlink"
DEFAULT_TEMPLATE_PATH: Final[Path] = Path(__file__).resolve().parents[1] / "templates" / "song-card-template.svg"


def _xml_name(namespace: str, name: str) -> str:
    """Build a namespaced XML tag name for ElementTree operations."""
    return f"{{{namespace}}}{name}"


def _wrap_text(value: str, max_chars: int, max_lines: int) -> list[str]:
    """Wrap plain text into line chunks and clip overflow with ellipsis."""
    text = " ".join(value.split())
    if not text:
        return [""]

    words = text.split(" ")
    lines: list[str] = []
    current = ""

    for word in words:
        if len(word) > max_chars:
            if current:
                lines.append(current)
                current = ""
            for i in range(0, len(word), max_chars):
                lines.append(word[i : i + max_chars])
            continue

        candidate = word if not current else f"{current} {word}"
        if len(candidate) <= max_chars:
            current = candidate
        else:
            lines.append(current)
            current = word

    if current:
        lines.append(current)

    if len(lines) <= max_lines:
        return lines

    clipped = lines[:max_lines]
    last = clipped[-1]
    clipped[-1] = last[:-1] + "..." if len(last) >= max_chars else f"{last}..."
    return clipped


def _set_text_lines(
    root: ET.Element,
    text_id: str,
    value: str,
    x: float,
    y_center: float,
    line_height: float,
    max_chars: int,
    max_lines: int,
) -> None:
    """Replace a template text node with centered multiline <tspan> content."""
    text_node = root.find(f".//{{{SVG_NS}}}text[@id='{text_id}']")
    if text_node is None:
        raise ValueError(f"Template is missing text node id='{text_id}'")

    lines = _wrap_text(value, max_chars=max_chars, max_lines=max_lines)
    start_y = y_center - ((len(lines) - 1) * line_height / 2)
    text_node.set("x", f"{x:.0f}")
    text_node.set("y", f"{start_y:.1f}")
    text_node.text = None

    for child in list(text_node):
        text_node.remove(child)

    for index, line in enumerate(lines):
        tspan = ET.SubElement(text_node, _xml_name(SVG_NS, "tspan"))
        tspan.set("x", f"{x:.0f}")
        if index > 0:
            tspan.set("dy", f"{line_height:.1f}")
        tspan.text = line


def build_qr_data_uri(spotify_url: str, size_px: int = 390) -> str:
    """Generate a QR PNG and return it as an SVG-safe data URI."""
    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(spotify_url)
    qr.make(fit=True)
    qr_image = qr.make_image(fill_color="black", back_color="white")
    image = qr_image.get_image().convert("RGB").resize((size_px, size_px))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def render_song_card_svg(song: SongCardData, template_svg: str) -> str:
    """Inject song data into the SVG template and return rendered SVG text."""
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", XLINK_NS)

    root = ET.fromstring(template_svg)
    qr_node = root.find(f".//{{{SVG_NS}}}image[@id='qr-code']")
    if qr_node is None:
        raise ValueError("Template is missing image node id='qr-code'")

    qr_data_uri = build_qr_data_uri(song.spotify_url)
    qr_node.set("href", qr_data_uri)
    qr_node.set(_xml_name(XLINK_NS, "href"), qr_data_uri)

    _set_text_lines(
        root,
        text_id="artist-text",
        value=song.artist_name,
        x=1200,
        y_center=170,
        line_height=48,
        max_chars=24,
        max_lines=2,
    )
    _set_text_lines(
        root,
        text_id="date-text",
        value=normalize_release_date(song.release_date),
        x=1200,
        y_center=400,
        line_height=70,
        max_chars=16,
        max_lines=2,
    )
    _set_text_lines(
        root,
        text_id="song-text",
        value=song.song_name,
        x=1200,
        y_center=650,
        line_height=56,
        max_chars=22,
        max_lines=3,
    )

    return ET.tostring(root, encoding="unicode")


def create_song_card(
    song: SongCardData,
    output_path: str,
    template_svg: str,
    image_width_px: int = 1600,
) -> None:
    """Render one song card from SVG template and write it as a PNG file."""
    image_height_px = max(1, image_width_px // 2)
    rendered_svg = render_song_card_svg(song, template_svg)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(
        bytestring=rendered_svg.encode("utf-8"),
        write_to=output_path,
        output_width=image_width_px,
        output_height=image_height_px,
    )


def create_song_cards_batch(
    songs: list[SongCardData],
    output_dir: str,
    template_path: str = str(DEFAULT_TEMPLATE_PATH),
    image_width_px: int = 1600,
) -> list[str]:
    """Generate card PNGs for all songs and return written file paths."""
    output_root = Path(output_dir)
    output_root.mkdir(parents=True, exist_ok=True)
    template_svg = Path(template_path).read_text(encoding="utf-8")

    generated: list[str] = []
    for index, song in enumerate(songs, start=1):
        file_name = f"{index:03d}_{slugify_filename(song.artist_name)}_{slugify_filename(song.song_name)}.png"
        target = output_root / file_name
        create_song_card(song, str(target), template_svg=template_svg, image_width_px=image_width_px)
        generated.append(str(target))

    return generated
