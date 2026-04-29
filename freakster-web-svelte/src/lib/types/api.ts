import type { SongCardData } from '$lib/types/song-card';

export type PlaylistJobStatus = 'running' | 'done' | 'error';

export type PlaylistJobStage = 'queued' | 'downloading' | 'enhancing' | 'done' | 'error';

export type PlaylistJobProgress = {
	current: number;
	total: number | null;
	percent: number | null;
	message: string;
};

export type PlaylistMetadata = {
	name: string | null;
	imageUrl: string | null;
};

export type PlaylistJobResponse = {
	jobId: string;
	status: PlaylistJobStatus;
	stage: PlaylistJobStage;
	progress: PlaylistJobProgress;
	playlist: PlaylistMetadata;
	skippedWithoutSpotifyUrl: number;
	error: string | null;
	songs: SongCardData[] | null;
};
