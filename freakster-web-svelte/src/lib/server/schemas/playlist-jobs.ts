import { z } from 'zod';

import { badRequest } from '$lib/server/http-errors';

const createPlaylistJobSchema = z.object({
	playlistRef: z.string().trim().min(1, 'Please enter a Spotify playlist URL, URI, or ID.')
});

export function parseCreatePlaylistJobPayload(payload: unknown): { playlistRef: string } {
	const parsed = createPlaylistJobSchema.safeParse(payload);
	if (!parsed.success) {
		const message = parsed.error.issues[0]?.message ?? 'Invalid request payload.';
		badRequest(message, 'INVALID_PAYLOAD');
	}

	return parsed.data;
}
