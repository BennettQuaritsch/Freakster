import { PDFDocument, PageSizes } from 'pdf-lib';

import type { SongCardImageBytes } from '$lib/types/song-card';

const MM_TO_PT = 72 / 25.4;

export type PdfBuildOptions = {
	cardSideMm?: number;
	marginMm?: number;
	gapMm?: number;
	orientation?: 'landscape' | 'portrait';
};

function mmToPt(mm: number): number {
	return mm * MM_TO_PT;
}

export async function buildCardsPdf(
	images: SongCardImageBytes[],
	options: PdfBuildOptions = {}
): Promise<Uint8Array> {
	if (images.length === 0) {
		throw new Error('No card images available for PDF generation');
	}

	const cardSideMm = options.cardSideMm ?? 60;
	const marginMm = options.marginMm ?? 0;
	const gapMm = options.gapMm ?? 0;
	const orientation = options.orientation ?? 'landscape';

	const [a4Width, a4Height] = PageSizes.A4;
	const pageWidth = orientation === 'landscape' ? a4Height : a4Width;
	const pageHeight = orientation === 'landscape' ? a4Width : a4Height;

	const margin = mmToPt(marginMm);
	const gap = mmToPt(gapMm);
	const cardWidth = mmToPt(cardSideMm * 2);
	const cardHeight = mmToPt(cardSideMm);

	const usableWidth = pageWidth - margin * 2;
	const usableHeight = pageHeight - margin * 2;
	const cols = Math.floor((usableWidth + gap) / (cardWidth + gap));
	const rows = Math.floor((usableHeight + gap) / (cardHeight + gap));

	if (cols < 1 || rows < 1) {
		throw new Error('Card size and margins are too large for an A4 page');
	}

	const perPage = cols * rows;
	const pdf = await PDFDocument.create();
	let page = pdf.addPage([pageWidth, pageHeight]);

	for (let index = 0; index < images.length; index += 1) {
		const slot = index % perPage;
		if (index > 0 && slot === 0) {
			page = pdf.addPage([pageWidth, pageHeight]);
		}

		const row = Math.floor(slot / cols);
		const col = slot % cols;
		const x = margin + col * (cardWidth + gap);
		const yTop = pageHeight - margin - row * (cardHeight + gap);
		const y = yTop - cardHeight;

		const png = await pdf.embedPng(images[index].bytes);

		page.drawImage(png, {
			x,
			y,
			width: cardWidth,
			height: cardHeight
		});
	}

	const pdfBytes = await pdf.save();
	return new Uint8Array(Array.from(pdfBytes));
}
