import { PDFDocument, PageSizes, type PDFImage, type PDFPage } from 'pdf-lib';

import type { DuplexCardImages } from '$lib/server/card-render';
import { badRequest } from '$lib/server/http-errors';
import type { SongCardImageBytes } from '$lib/types/song-card';

const MM_TO_PT = 72 / 25.4;

export type PdfBuildOptions = {
	cardSideMm?: number;
	marginMm?: number;
	gapMm?: number;
	orientation?: 'landscape' | 'portrait';
};

export type FoldPdfInput = { mode: 'fold'; cards: SongCardImageBytes[] };
export type DuplexPdfInput = { mode: 'duplex'; cards: DuplexCardImages[] };
export type PdfInput = FoldPdfInput | DuplexPdfInput;

function mmToPt(mm: number): number {
	return mm * MM_TO_PT;
}

function pageDimensions(orientation: 'landscape' | 'portrait'): [number, number] {
	const [a4Width, a4Height] = PageSizes.A4;
	const pageWidth = orientation === 'landscape' ? a4Height : a4Width;
	const pageHeight = orientation === 'landscape' ? a4Width : a4Height;
	return [pageWidth, pageHeight];
}

function drawSlot(
	page: PDFPage,
	image: PDFImage,
	slotX: number,
	slotY: number,
	cardWidth: number,
	cardHeight: number
): void {
	page.drawImage(image, {
		x: slotX,
		y: slotY,
		width: cardWidth,
		height: cardHeight
	});
}

async function buildFoldPdf(
	cards: SongCardImageBytes[],
	options: PdfBuildOptions
): Promise<Uint8Array> {
	const cardSideMm = options.cardSideMm ?? 60;
	const marginMm = options.marginMm ?? 0;
	const gapMm = options.gapMm ?? 0;
	const orientation = options.orientation ?? 'landscape';

	const [pageWidth, pageHeight] = pageDimensions(orientation);
	const margin = mmToPt(marginMm);
	const gap = mmToPt(gapMm);
	const cardWidth = mmToPt(cardSideMm * 2);
	const cardHeight = mmToPt(cardSideMm);

	const usableWidth = pageWidth - margin * 2;
	const usableHeight = pageHeight - margin * 2;
	const cols = Math.floor((usableWidth + gap) / (cardWidth + gap));
	const rows = Math.floor((usableHeight + gap) / (cardHeight + gap));

	if (cols < 1 || rows < 1) {
		badRequest('Card size and margins are too large for an A4 page');
	}

	const perPage = cols * rows;
	const pdf = await PDFDocument.create();
	let page = pdf.addPage([pageWidth, pageHeight]);

	for (let index = 0; index < cards.length; index += 1) {
		const slot = index % perPage;
		if (index > 0 && slot === 0) {
			page = pdf.addPage([pageWidth, pageHeight]);
		}

		const row = Math.floor(slot / cols);
		const col = slot % cols;
		const x = margin + col * (cardWidth + gap);
		const yTop = pageHeight - margin - row * (cardHeight + gap);
		const y = yTop - cardHeight;

		const png = await pdf.embedPng(cards[index].bytes);
		drawSlot(page, png, x, y, cardWidth, cardHeight);
	}

	const pdfBytes = await pdf.save();
	return new Uint8Array(Array.from(pdfBytes));
}

async function buildDuplexPdf(
	cards: DuplexCardImages[],
	options: PdfBuildOptions
): Promise<Uint8Array> {
	const cardSideMm = options.cardSideMm ?? 60;
	const marginMm = options.marginMm ?? 0;
	const gapMm = options.gapMm ?? 0;
	const orientation = options.orientation ?? 'landscape';

	const [pageWidth, pageHeight] = pageDimensions(orientation);
	const margin = mmToPt(marginMm);
	const gap = mmToPt(gapMm);
	const cardWidth = mmToPt(cardSideMm);
	const cardHeight = mmToPt(cardSideMm);

	const usableWidth = pageWidth - margin * 2;
	const usableHeight = pageHeight - margin * 2;
	const cols = Math.floor((usableWidth + gap) / (cardWidth + gap));
	const rows = Math.floor((usableHeight + gap) / (cardHeight + gap));

	if (cols < 1 || rows < 1) {
		badRequest('Card size and margins are too large for an A4 page');
	}

	const perPage = cols * rows;
	const pdf = await PDFDocument.create();

	for (let chunkStart = 0; chunkStart < cards.length; chunkStart += perPage) {
		const chunk = cards.slice(chunkStart, chunkStart + perPage);
		const frontPage = pdf.addPage([pageWidth, pageHeight]);
		const backPage = pdf.addPage([pageWidth, pageHeight]);

		for (let slot = 0; slot < chunk.length; slot += 1) {
			const pair = chunk[slot];
			const row = Math.floor(slot / cols);
			const col = slot % cols;

			const xFront = margin + col * (cardWidth + gap);
			const yTopFront = pageHeight - margin - row * (cardHeight + gap);
			const yFront = yTopFront - cardHeight;

			// Long-edge duplex flip:
			//   landscape: sheet flips around horizontal long edge => vertical mirror (rows reversed)
			//   portrait:  sheet flips around vertical long edge   => horizontal mirror (cols reversed)
			let backRow = row;
			let backCol = col;
			if (orientation === 'landscape') {
				backRow = rows - 1 - row;
			} else {
				backCol = cols - 1 - col;
			}

			const xBack = margin + backCol * (cardWidth + gap);
			const yTopBack = pageHeight - margin - backRow * (cardHeight + gap);
			const yBack = yTopBack - cardHeight;

			const frontPng = await pdf.embedPng(pair.front.bytes);
			const backPng = await pdf.embedPng(pair.back.bytes);
			drawSlot(frontPage, frontPng, xFront, yFront, cardWidth, cardHeight);
			drawSlot(backPage, backPng, xBack, yBack, cardWidth, cardHeight);
		}
	}

	const pdfBytes = await pdf.save();
	return new Uint8Array(Array.from(pdfBytes));
}

export async function buildCardsPdf(
	input: PdfInput,
	options: PdfBuildOptions = {}
): Promise<Uint8Array> {
	if (input.cards.length === 0) {
		throw new Error('No card images available for PDF generation');
	}

	if (input.mode === 'duplex') {
		return buildDuplexPdf(input.cards, options);
	}

	return buildFoldPdf(input.cards, options);
}
