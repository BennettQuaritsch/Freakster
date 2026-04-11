export type SongCardData = {
	artist_name: string;
	song_name: string;
	spotify_url: string;
	isrc: string | null;
	release_date: string | null;
};

export type SongCardImage = {
	fileName: string;
	blob: Blob;
};

export type SongCardImageBytes = {
	fileName: string;
	bytes: Uint8Array;
	width: number;
	height: number;
};

export function normalizeReleaseDate(value: string | null | undefined): string {
	if (!value) {
		return 'Unknown';
	}

	const trimmed = value.trim();
	return trimmed || 'Unknown';
}

export function slugifyFileName(value: string): string {
	const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '');
	return cleaned || 'song';
}
