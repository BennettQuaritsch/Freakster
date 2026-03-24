from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib.pagesizes import A4, landscape, portrait
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def build_pdf(
    input_dir: str,
    output_pdf: str,
    card_side_mm: float,
    margin_mm: float,
    gap_mm: float,
    orientation: str,
) -> int:
    source = Path(input_dir)
    images = sorted(source.glob("*.png"))
    if not images:
        raise ValueError(f"No PNG files found in {input_dir}")

    page_size = landscape(A4) if orientation == "landscape" else portrait(A4)
    page_width, page_height = page_size

    margin = margin_mm * mm
    gap = gap_mm * mm
    card_width = (card_side_mm * 2) * mm
    card_height = card_side_mm * mm

    usable_width = page_width - (2 * margin)
    usable_height = page_height - (2 * margin)
    cols = int((usable_width + gap) // (card_width + gap))
    rows = int((usable_height + gap) // (card_height + gap))
    if cols < 1 or rows < 1:
        raise ValueError("Card size/margins are too large for A4 page")

    per_page = cols * rows
    Path(output_pdf).parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(output_pdf, pagesize=page_size)

    for index, image_path in enumerate(images):
        slot = index % per_page
        if index > 0 and slot == 0:
            pdf.showPage()

        row = slot // cols
        col = slot % cols
        x = margin + col * (card_width + gap)
        y_top = page_height - margin - row * (card_height + gap)
        y = y_top - card_height

        pdf.drawImage(
            str(image_path),
            x,
            y,
            width=card_width,
            height=card_height,
            preserveAspectRatio=True,
            mask="auto",
        )

    pdf.save()
    return len(images)


def main() -> None:
    parser = argparse.ArgumentParser(description="Pack generated card PNGs into an A4 PDF")
    parser.add_argument("--input-dir", default="output/cards", help="Directory containing card PNGs")
    parser.add_argument("--output", default="output/cards-a4.pdf", help="Output PDF path")
    parser.add_argument("--card-side-mm", type=float, default=60.0, help="Folded card side in mm")
    parser.add_argument("--margin-mm", type=float, default=0.0, help="Page margin in mm")
    parser.add_argument("--gap-mm", type=float, default=0.0, help="Gap between cards in mm")
    parser.add_argument(
        "--orientation",
        choices=("landscape", "portrait"),
        default="landscape",
        help="A4 page orientation",
    )
    args = parser.parse_args()

    total = build_pdf(
        input_dir=args.input_dir,
        output_pdf=args.output,
        card_side_mm=args.card_side_mm,
        margin_mm=args.margin_mm,
        gap_mm=args.gap_mm,
        orientation=args.orientation,
    )
    print(f"Packed {total} cards into {args.output}")


if __name__ == "__main__":
    main()
