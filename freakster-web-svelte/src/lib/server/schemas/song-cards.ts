import { z } from 'zod';

import { classifyReleaseDate } from '$lib/date-validation';
import { badRequest } from '$lib/server/http-errors';
import type { SongCardData } from '$lib/types/song-card';

const MAX_SONGS = 500;
const MAX_ARTIST_NAME_LENGTH = 256;
const MAX_SONG_NAME_LENGTH = 256;
const MAX_SPOTIFY_URL_LENGTH = 512;
const MAX_ISRC_LENGTH = 64;
const MAX_RELEASE_DATE_LENGTH = 10;
const MAX_PLAYLIST_NAME_LENGTH = 256;

const requiredString = (field: string, maxLength: number) =>
	z
		.string()
		.trim()
		.min(1, `${field} is required.`)
		.max(maxLength, `${field} must be at most ${maxLength} characters.`);

const optionalNullableString = (field: string, maxLength: number) =>
	z
		.union([
			z.string().trim().max(maxLength, `${field} must be at most ${maxLength} characters.`),
			z.null(),
			z.undefined()
		])
		.transform((value) => {
			if (typeof value !== 'string') {
				return null;
			}
			const trimmed = value.trim();
			return trimmed || null;
		});

const songSchema = z
	.object({
		artist_name: requiredString('artist_name', MAX_ARTIST_NAME_LENGTH),
		song_name: requiredString('song_name', MAX_SONG_NAME_LENGTH),
		spotify_url: requiredString('spotify_url', MAX_SPOTIFY_URL_LENGTH),
		isrc: optionalNullableString('isrc', MAX_ISRC_LENGTH),
		release_date: optionalNullableString('release_date', MAX_RELEASE_DATE_LENGTH)
	})
	.superRefine((value, ctx) => {
		if (classifyReleaseDate(value.release_date) === 'invalid') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['release_date'],
				message: 'Use YYYY-MM-DD, YYYY-MM, YYYY, or leave blank.'
			});
		}
	});

const payloadSchema = z.object({
	songs: z.array(songSchema).min(1, 'No songs available for PDF generation.').max(MAX_SONGS),
	playlistName: optionalNullableString('playlistName', MAX_PLAYLIST_NAME_LENGTH),
	duplex: z.boolean()
});

export type SongCardsPayload = {
	songs: SongCardData[];
	playlistName: string | null;
	duplex: boolean;
};

function formatPath(path: PropertyKey[]): string {
	const safePath = path.filter(
		(segment): segment is string | number =>
			typeof segment === 'string' || typeof segment === 'number'
	);

	if (safePath.length === 0) {
		return 'payload';
	}

	const [first, ...rest] = safePath;
	if (first === 'songs' && typeof rest[0] === 'number') {
		const index = Number(rest[0]) + 1;
		const field = typeof rest[1] === 'string' ? rest[1] : null;
		return field ? `songs[${index}].${field}` : `songs[${index}]`;
	}

	return path.join('.');
}

function firstIssueMessage(error: z.ZodError): string {
	const issue = error.issues[0];
	if (!issue) {
		return 'Invalid request payload.';
	}

	if (
		issue.path.length === 1 &&
		issue.path[0] === 'songs' &&
		issue.code === z.ZodIssueCode.too_big
	) {
		return `Too many songs for PDF generation. Maximum allowed is ${MAX_SONGS}.`;
	}

	if (issue.path.length === 1 && issue.path[0] === 'songs') {
		return issue.message;
	}

	return `${formatPath(issue.path)}: ${issue.message}`;
}

export function parseSongCardsPayload(payload: unknown): SongCardsPayload {
	const parsed = payloadSchema.safeParse(payload);
	if (!parsed.success) {
		badRequest(firstIssueMessage(parsed.error), 'INVALID_PAYLOAD');
	}

	return {
		songs: parsed.data.songs.map((song) => ({ ...song })),
		playlistName: parsed.data.playlistName,
		duplex: parsed.data.duplex
	};
}
