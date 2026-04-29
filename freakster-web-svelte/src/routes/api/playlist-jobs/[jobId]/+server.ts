import { json } from '@sveltejs/kit';

import { requireAppSessionId, requireJobId, requireSpotifyAuth } from '$lib/server/guards';
import { notFound, toErrorResponse } from '$lib/server/http-errors';
import { getPlaylistJob } from '$lib/server/playlist-jobs';
import type { PlaylistJobResponse } from '$lib/types/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		await requireSpotifyAuth(event);

		const jobId = requireJobId(event.params.jobId);
		const ownerSessionId = requireAppSessionId(event);

		const job = getPlaylistJob(jobId, ownerSessionId);
		if (!job) {
			notFound('Playlist job not found or expired.');
		}

		const response: PlaylistJobResponse = {
			jobId: job.jobId,
			status: job.status,
			stage: job.stage,
			progress: job.progress,
			playlist: job.playlist,
			skippedWithoutSpotifyUrl: job.skippedWithoutSpotifyUrl,
			error: job.error,
			songs: job.status === 'done' ? (job.songs ?? []) : null
		};

		return json(response, {
			headers: {
				'Cache-Control': 'no-store'
			}
		});
	} catch (error) {
		return toErrorResponse(error, 'Unexpected playlist polling error.');
	}
};
