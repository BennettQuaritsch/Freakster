import { json } from '@sveltejs/kit';

import { createSongCardsBatch } from '$lib/server/card-render';
import { buildCardsPdf } from '$lib/server/pdf';
import { classifyReleaseDate } from '$lib/date-validation';
import { getValidSpotifyAccessToken } from '$lib/server/spotify';
import type { SongCardData } from '$lib/types/song-card';
import type { RequestHandler } from './$types';

const MAX_SONGS = 500;
const MAX_ARTIST_NAME_LENGTH = 256;
const MAX_SONG_NAME_LENGTH = 256;
const MAX_SPOTIFY_URL_LENGTH = 512;
const MAX_ISRC_LENGTH = 64;
const MAX_RELEASE_DATE_LENGTH = 10;

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
		normalized.includes('invalid request payload') ||
		normalized.includes('songs payload') ||
		normalized.includes('no songs available') ||
		normalized.includes('too many songs') ||
		normalized.includes('too long') ||
		normalized.includes('invalid release date') ||
		normalized.includes('card size and margins are too large')
	) {
		return 400;
	}

	return 500;
}

function asNonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed || null;
}

function assertMaxLength(value: string, maxLength: number, fieldName: string, index: number): void {
	if (value.length > maxLength) {
		throw new Error(
			`Songs payload item ${index + 1} has ${fieldName} that is too long (max ${maxLength} characters).`
		);
	}
}

function validateSongsPayload(payload: unknown): SongCardData[] {
	if (!payload || typeof payload !== 'object') {
		throw new Error('Invalid request payload.');
	}

	const songsRaw = (payload as { songs?: unknown }).songs;
	if (!Array.isArray(songsRaw)) {
		throw new Error('Songs payload must be an array.');
	}

	if (songsRaw.length === 0) {
		throw new Error('No songs available for PDF generation.');
	}

	if (songsRaw.length > MAX_SONGS) {
		throw new Error(`Too many songs for PDF generation. Maximum allowed is ${MAX_SONGS}.`);
	}

	const songs: SongCardData[] = songsRaw.map((item, index) => {
		if (!item || typeof item !== 'object') {
			throw new Error(`Songs payload item ${index + 1} must be an object.`);
		}

		const artistName = asNonEmptyString((item as { artist_name?: unknown }).artist_name);
		const songName = asNonEmptyString((item as { song_name?: unknown }).song_name);
		const spotifyUrl = asNonEmptyString((item as { spotify_url?: unknown }).spotify_url);
		const releaseDateRaw = (item as { release_date?: unknown }).release_date;

		if (!artistName) {
			throw new Error(`Songs payload item ${index + 1} is missing artist_name.`);
		}
		assertMaxLength(artistName, MAX_ARTIST_NAME_LENGTH, 'artist_name', index);

		if (!songName) {
			throw new Error(`Songs payload item ${index + 1} is missing song_name.`);
		}
		assertMaxLength(songName, MAX_SONG_NAME_LENGTH, 'song_name', index);

		if (!spotifyUrl) {
			throw new Error(`Songs payload item ${index + 1} is missing spotify_url.`);
		}
		assertMaxLength(spotifyUrl, MAX_SPOTIFY_URL_LENGTH, 'spotify_url', index);

		let isrc: string | null = null;
		const isrcRaw = (item as { isrc?: unknown }).isrc;
		if (typeof isrcRaw === 'string') {
			isrc = isrcRaw.trim() || null;
			if (isrc) {
				assertMaxLength(isrc, MAX_ISRC_LENGTH, 'isrc', index);
			}
		} else if (isrcRaw !== undefined && isrcRaw !== null) {
			throw new Error(`Songs payload item ${index + 1} has invalid isrc.`);
		}

		let releaseDate: string | null = null;
		if (typeof releaseDateRaw === 'string') {
			releaseDate = releaseDateRaw.trim() || null;
			if (releaseDate) {
				assertMaxLength(releaseDate, MAX_RELEASE_DATE_LENGTH, 'release_date', index);
			}
		} else if (releaseDateRaw !== undefined && releaseDateRaw !== null) {
			throw new Error(`Songs payload item ${index + 1} has invalid release_date.`);
		}

		if (classifyReleaseDate(releaseDate) === 'invalid') {
			throw new Error(
				`Invalid release date at song ${index + 1}. Use YYYY-MM-DD, YYYY-MM, YYYY, or leave blank.`
			);
		}

		return {
			artist_name: artistName,
			song_name: songName,
			spotify_url: spotifyUrl,
			isrc,
			release_date: releaseDate
		};
	});

	return songs;
}

export const POST: RequestHandler = async (event) => {
	if (!(await getValidSpotifyAccessToken(event))) {
		return json(
			{ error: 'Spotify authentication required. Connect Spotify and try again.' },
			{ status: 401 }
		);
	}

	let songs: SongCardData[];
	try {
		const payload = (await event.request.json()) as unknown;
		songs = validateSongsPayload(payload);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Invalid request payload.';
		return json({ error: message }, { status: classifyErrorStatus(message) });
	}

	let stage = 'card-render';

	try {
		stage = 'card-render';
		const images = await createSongCardsBatch(songs);
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
				'X-Freakster-Skipped-Count': '0'
			}
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unexpected error while generating PDF on server.';
		console.error(`[generate-pdf] stage=${stage} failed`, error);
		return json({ error: message, stage }, { status: classifyErrorStatus(message) });
	}
};
