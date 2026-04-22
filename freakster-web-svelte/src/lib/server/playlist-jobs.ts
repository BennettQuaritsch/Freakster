import type { SongCardData } from '$lib/types/song-card';
import type { PlaylistMeta } from '$lib/server/spotify';

const JOB_TTL_MS = 30 * 60 * 1000;

export type PlaylistJobStatus = 'running' | 'done' | 'error';

export type PlaylistJobStage = 'queued' | 'downloading' | 'enhancing' | 'done' | 'error';

export type PlaylistJobProgress = {
	current: number;
	total: number | null;
	percent: number | null;
	message: string;
};

export type PlaylistJobRecord = {
	jobId: string;
	ownerSessionId: string;
	status: PlaylistJobStatus;
	stage: PlaylistJobStage;
	progress: PlaylistJobProgress;
	playlist: PlaylistMeta;
	skippedWithoutSpotifyUrl: number;
	songs: SongCardData[] | null;
	error: string | null;
	playlistRef: string;
	createdAt: number;
	updatedAt: number;
	expiresAt: number;
};

const jobs = new Map<string, PlaylistJobRecord>();

function now(): number {
	return Date.now();
}

function generateJobId(): string {
	return crypto.randomUUID();
}

function cleanupExpiredJobs(): void {
	const timestamp = now();
	for (const [jobId, job] of jobs.entries()) {
		if (timestamp >= job.expiresAt) {
			jobs.delete(jobId);
		}
	}
}

function refreshExpiry(job: PlaylistJobRecord): PlaylistJobRecord {
	const timestamp = now();
	job.updatedAt = timestamp;
	job.expiresAt = timestamp + JOB_TTL_MS;
	return job;
}

export function createPlaylistJob(playlistRef: string, ownerSessionId: string): PlaylistJobRecord {
	cleanupExpiredJobs();
	const timestamp = now();
	const jobId = generateJobId();
	const job: PlaylistJobRecord = {
		jobId,
		ownerSessionId,
		status: 'running',
		stage: 'queued',
		progress: {
			current: 0,
			total: null,
			percent: 0,
			message: 'Queued'
		},
		playlist: {
			name: null,
			imageUrl: null
		},
		skippedWithoutSpotifyUrl: 0,
		songs: null,
		error: null,
		playlistRef,
		createdAt: timestamp,
		updatedAt: timestamp,
		expiresAt: timestamp + JOB_TTL_MS
	};

	jobs.set(jobId, job);
	return job;
}

export function getPlaylistJob(jobId: string, ownerSessionId: string): PlaylistJobRecord | null {
	cleanupExpiredJobs();
	const job = jobs.get(jobId);
	if (!job) {
		return null;
	}

	if (job.ownerSessionId !== ownerSessionId) {
		return null;
	}

	return refreshExpiry(job);
}

export function updatePlaylistJob(
	jobId: string,
	updates: {
		stage: PlaylistJobStage;
		progress: PlaylistJobProgress;
		skippedWithoutSpotifyUrl?: number;
		playlist?: PlaylistMeta;
	}
): void {
	const job = jobs.get(jobId);
	if (!job) {
		return;
	}

	job.status = 'running';
	job.stage = updates.stage;
	job.progress = updates.progress;
	job.skippedWithoutSpotifyUrl =
		typeof updates.skippedWithoutSpotifyUrl === 'number'
			? updates.skippedWithoutSpotifyUrl
			: job.skippedWithoutSpotifyUrl;
	job.playlist = updates.playlist ?? job.playlist;
	refreshExpiry(job);
}

export function markPlaylistJobDone(
	jobId: string,
	data: {
		songs: SongCardData[];
		skippedWithoutSpotifyUrl: number;
		playlist?: PlaylistMeta;
	}
): void {
	const job = jobs.get(jobId);
	if (!job) {
		return;
	}

	job.status = 'done';
	job.stage = 'done';
	job.progress = {
		current: data.songs.length,
		total: data.songs.length,
		percent: 100,
		message: 'Done'
	};
	job.skippedWithoutSpotifyUrl = data.skippedWithoutSpotifyUrl;
	job.playlist = data.playlist ?? job.playlist;
	job.songs = data.songs;
	job.error = null;
	refreshExpiry(job);
}

export function markPlaylistJobError(jobId: string, message: string): void {
	const job = jobs.get(jobId);
	if (!job) {
		return;
	}

	job.status = 'error';
	job.stage = 'error';
	job.error = message;
	job.progress = {
		...job.progress,
		message: 'Failed'
	};
	refreshExpiry(job);
}
