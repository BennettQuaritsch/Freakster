import { json } from '@sveltejs/kit';

import { getOrCreateAppSessionId, parseJsonBody, requireSpotifyAuth } from '$lib/server/guards';
import { toErrorResponse } from '$lib/server/http-errors';
import {
	createPlaylistJob,
	markPlaylistJobDone,
	markPlaylistJobError,
	updatePlaylistJob
} from '$lib/server/playlist-jobs';
import { parseCreatePlaylistJobPayload } from '$lib/server/schemas/playlist-jobs';
import { enrichReleaseDates } from '$lib/server/musicbrainz';
import { getPlaylistTracks, type PlaylistTracksProgress } from '$lib/server/spotify';
import type { RequestHandler } from './$types';

function toDownloadProgressLabel(progress: PlaylistTracksProgress): string {
	if (progress.totalItems && progress.totalItems > 0) {
		return `Downloading songs (${Math.min(progress.fetchedItems, progress.totalItems)}/${progress.totalItems})`;
	}

	return `Downloading songs (${progress.fetchedItems})`;
}

function toDownloadProgressPercentage(progress: PlaylistTracksProgress): number | null {
	if (!progress.totalItems || progress.totalItems <= 0) {
		return null;
	}

	const ratio = Math.min(1, progress.fetchedItems / progress.totalItems);
	return Math.round(ratio * 45);
}

async function runPlaylistJob(
	event: Parameters<RequestHandler>[0],
	jobId: string,
	playlistRef: string
): Promise<void> {
	try {
		const {
			songs: tracks,
			skippedWithoutSpotifyUrl,
			playlist
		} = await getPlaylistTracks(event, playlistRef, {
			onProgress: (progress) => {
				updatePlaylistJob(jobId, {
					stage: 'downloading',
					progress: {
						current: progress.fetchedItems,
						total: progress.totalItems,
						percent: toDownloadProgressPercentage(progress),
						message: toDownloadProgressLabel(progress)
					},
					skippedWithoutSpotifyUrl: progress.skippedWithoutSpotifyUrl,
					playlist: progress.playlist
				});
			}
		});

		if (tracks.length === 0) {
			throw new Error('This playlist returned no playable tracks.');
		}

		updatePlaylistJob(jobId, {
			stage: 'enhancing',
			progress: {
				current: 0,
				total: tracks.length,
				percent: tracks.length > 0 ? 45 : 60,
				message: `Enhancing release dates (0/${tracks.length})`
			},
			skippedWithoutSpotifyUrl,
			playlist
		});

		const enriched = await enrichReleaseDates(tracks, {
			onProgress: (progress) => {
				const enhancementRatio = progress.total > 0 ? progress.processed / progress.total : 1;
				updatePlaylistJob(jobId, {
					stage: 'enhancing',
					progress: {
						current: progress.processed,
						total: progress.total,
						percent: Math.round(45 + Math.min(1, enhancementRatio) * 55),
						message: `Enhancing release dates (${progress.processed}/${progress.total})`
					},
					skippedWithoutSpotifyUrl,
					playlist
				});
			}
		});

		markPlaylistJobDone(jobId, {
			songs: enriched,
			skippedWithoutSpotifyUrl,
			playlist
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unexpected playlist job error.';
		markPlaylistJobError(jobId, message);
		console.error(`[playlist-jobs] job=${jobId} failed`, error);
	}
}

export const POST: RequestHandler = async (event) => {
	try {
		await requireSpotifyAuth(event);

		const payload = await parseJsonBody(event);
		const { playlistRef } = parseCreatePlaylistJobPayload(payload);

		const ownerSessionId = getOrCreateAppSessionId(event);
		const job = createPlaylistJob(playlistRef, ownerSessionId);
		updatePlaylistJob(job.jobId, {
			stage: 'downloading',
			progress: {
				current: 0,
				total: null,
				percent: 0,
				message: 'Downloading songs...'
			},
			skippedWithoutSpotifyUrl: 0
		});

		void runPlaylistJob(event, job.jobId, playlistRef);

		return json(
			{
				jobId: job.jobId,
				status: 'running'
			},
			{
				status: 202,
				headers: {
					'Cache-Control': 'no-store'
				}
			}
		);
	} catch (error) {
		return toErrorResponse(error, 'Unexpected playlist job creation error.');
	}
};
