import { createSongCardsBatch } from '$lib/server/card-render';
import { parseJsonBody, requireSpotifyAuth } from '$lib/server/guards';
import { AppHttpError, toErrorResponse } from '$lib/server/http-errors';
import { buildCardsPdf } from '$lib/server/pdf';
import { parseSongCardsPayload } from '$lib/server/schemas/song-cards';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		await requireSpotifyAuth(event);
		const payload = await parseJsonBody(event);
		const songs = parseSongCardsPayload(payload);

		const images = await createSongCardsBatch(songs);
		const pdfBytes = await buildCardsPdf(images, {
			orientation: 'landscape',
			cardSideMm: 49.5,
			marginMm: 0,
			gapMm: 0
		});
		const safePdfBytes = Uint8Array.from(pdfBytes);

		const filename = `song-cards-${new Date().toISOString().slice(0, 10)}.pdf`;
		return new Response(safePdfBytes, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-store',
				'X-Freakster-Card-Count': String(images.length),
				'X-Freakster-Skipped-Count': '0'
			}
		});
	} catch (error) {
		if (error instanceof AppHttpError) {
			return toErrorResponse(error, 'Invalid request payload.');
		}

		console.error(`[generate-pdf] failed`, error);
		return toErrorResponse(error, 'Unexpected error while generating PDF on server.');
	}
};
