import { json } from '@sveltejs/kit';

import { createSongCardsBatch } from '$lib/server/card-render';
import { enrichReleaseDates } from '$lib/server/musicbrainz';
import { buildCardsPdf } from '$lib/server/pdf';
import { getPlaylistTracks, getValidSpotifyAccessToken } from '$lib/server/spotify';
import type { RequestHandler } from './$types';

function classifyErrorStatus(message: string): number {
	const normalized = message.toLowerCase();

	if (
		normalized.includes('spotify authentication required') ||
		normalized.includes('spotify authentication expired')
	) {
		return 401;
	}

	if (normalized.includes('spotify denied playlist access')) {
		return 403;
	}

	if (normalized.includes('spotify request failed: 404')) {
		return 404;
	}

	if (normalized.includes('unable to reach spotify web api')) {
		return 502;
	}

	if (
		normalized.includes('playlist reference is empty') ||
		normalized.includes('no playable tracks') ||
		normalized.includes('invalid request payload') ||
		normalized.includes('card size and margins are too large')
	) {
		return 400;
	}

	if (normalized.includes('musicbrainz request failed')) {
		return 502;
	}

	return 500;
}

export const POST: RequestHandler = async (event) => {
	if (!(await getValidSpotifyAccessToken(event))) {
		return json(
			{ error: 'Spotify authentication required. Connect Spotify and try again.' },
			{ status: 401 }
		);
	}

	let playlistRef = '';
	try {
		const payload = (await event.request.json()) as { playlistRef?: string };
		playlistRef = payload.playlistRef?.trim() ?? '';
	} catch {
		return json({ error: 'Invalid request payload.' }, { status: 400 });
	}

	if (!playlistRef) {
		return json({ error: 'Please enter a Spotify playlist URL, URI, or ID.' }, { status: 400 });
	}

	let stage = 'playlist';

	try {
		stage = 'playlist';
		const { songs: tracks, skippedWithoutSpotifyUrl } = await getPlaylistTracks(event, playlistRef);
		if (tracks.length === 0) {
			return json({ error: 'This playlist returned no playable tracks.' }, { status: 400 });
		}

		stage = 'release-dates';
		const enriched = await enrichReleaseDates(tracks);
		stage = 'card-render';
		const images = await createSongCardsBatch(enriched);
		stage = 'pdf-build';
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
				'X-Freakster-Skipped-Count': String(skippedWithoutSpotifyUrl)
			}
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unexpected error while generating PDF on server.';
		console.error(`[generate-pdf] stage=${stage} failed`, error);
		return json({ error: message, stage }, { status: classifyErrorStatus(message) });
	}
};
