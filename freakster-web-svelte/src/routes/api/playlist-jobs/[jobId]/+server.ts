import { json } from '@sveltejs/kit';

import { getPlaylistJob } from '$lib/server/playlist-jobs';
import { getValidSpotifyAccessToken } from '$lib/server/spotify';
import type { RequestHandler } from './$types';

const APP_SESSION_COOKIE = 'freakster_app_session';

export const GET: RequestHandler = async (event) => {
	if (!(await getValidSpotifyAccessToken(event))) {
		return json(
			{ error: 'Spotify authentication required. Connect Spotify and try again.' },
			{ status: 401 }
		);
	}

	const jobId = event.params.jobId?.trim() ?? '';
	if (!jobId) {
		return json({ error: 'Missing job id.' }, { status: 400 });
	}

	const ownerSessionId = event.cookies.get(APP_SESSION_COOKIE)?.trim() ?? '';
	if (!ownerSessionId) {
		return json({ error: 'Playlist job not found or expired.' }, { status: 404 });
	}

	const job = getPlaylistJob(jobId, ownerSessionId);
	if (!job) {
		return json({ error: 'Playlist job not found or expired.' }, { status: 404 });
	}

	return json(
		{
			jobId: job.jobId,
			status: job.status,
			stage: job.stage,
			progress: job.progress,
			playlist: job.playlist,
			skippedWithoutSpotifyUrl: job.skippedWithoutSpotifyUrl,
			error: job.error,
			songs: job.status === 'done' ? (job.songs ?? []) : null
		},
		{
			headers: {
				'Cache-Control': 'no-store'
			}
		}
	);
};
