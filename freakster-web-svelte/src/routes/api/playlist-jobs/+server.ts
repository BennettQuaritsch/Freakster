import { json } from '@sveltejs/kit';

import {
	createPlaylistJob,
	markPlaylistJobDone,
	markPlaylistJobError,
	updatePlaylistJob
} from '$lib/server/playlist-jobs';
import { enrichReleaseDates } from '$lib/server/musicbrainz';
import {
	getPlaylistTracks,
	getValidSpotifyAccessToken,
	type PlaylistTracksProgress
} from '$lib/server/spotify';
import type { RequestHandler } from './$types';

const APP_SESSION_COOKIE = 'freakster_app_session';

function getOrCreateAppSessionId(event: Parameters<RequestHandler>[0]): string {
	const existing = event.cookies.get(APP_SESSION_COOKIE)?.trim() ?? '';
	if (existing) {
		return existing;
	}

	const sessionId = crypto.randomUUID();
	event.cookies.set(APP_SESSION_COOKIE, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * 365
	});

	return sessionId;
}

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
	if (!(await getValidSpotifyAccessToken(event))) {
		return json(
			{ error: 'Spotify authentication required. Connect Spotify and try again.' },
			{ status: 401 }
		);
	}

	let playlistRef: string;
	try {
		const payload = (await event.request.json()) as { playlistRef?: string };
		playlistRef = payload.playlistRef?.trim() ?? '';
	} catch {
		return json({ error: 'Invalid request payload.' }, { status: 400 });
	}

	if (!playlistRef) {
		return json({ error: 'Please enter a Spotify playlist URL, URI, or ID.' }, { status: 400 });
	}

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
};
