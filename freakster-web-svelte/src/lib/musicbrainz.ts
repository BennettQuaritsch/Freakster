import type { SongCardData } from '$lib/types/song-card';

const FULL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_INTERVAL_MS = 1100;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const BASE_RETRY_DELAY_MS = 900;
const MAX_RETRY_DELAY_MS = 8_000;
const MUSICBRAINZ_CLIENT_NAME = 'freakster-web-svelte';
const MUSICBRAINZ_CLIENT_VERSION = '0.0.1';

type MusicBrainzRecording = {
	'first-release-date'?: string;
	releases?: Array<{ date?: string }>;
	'release-list'?: Array<{ date?: string }>;
	firstReleaseDate?: string;
};

type MusicBrainzIsrcResponse = {
	recordings?: MusicBrainzRecording[];
};

type ProgressHandler = (progress: { current: number; total: number }) => void;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMusicBrainz(endpoint: string): Promise<Response> {
	let attempt = 0;

	while (attempt < MAX_REQUEST_ATTEMPTS) {
		attempt += 1;
		const controller = new AbortController();
		const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			const response = await fetch(endpoint, {
				headers: {
					Accept: 'application/json'
				},
				signal: controller.signal
			});

			if (!RETRYABLE_STATUS_CODES.has(response.status)) {
				return response;
			}

			if (attempt >= MAX_REQUEST_ATTEMPTS) {
				return response;
			}
		} catch (error) {
			if (attempt >= MAX_REQUEST_ATTEMPTS) {
				throw error;
			}
		} finally {
			clearTimeout(timeoutHandle);
		}

		const exponentialDelay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** (attempt - 1));
		const jitter = Math.floor(Math.random() * 250);
		await sleep(exponentialDelay + jitter);
	}

	throw new Error('MusicBrainz request failed after multiple retries');
}

function isFullDate(value: string | null | undefined): value is string {
	return Boolean(value && FULL_DATE_PATTERN.test(value));
}

export async function findFirstReleaseDateByIsrc(isrc: string | null): Promise<string | null> {
	if (!isrc) {
		return null;
	}

	const endpoint =
		`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(`isrc:${isrc}`)}` +
		`&inc=releases&fmt=json&limit=100&client=${MUSICBRAINZ_CLIENT_NAME}&client_version=${MUSICBRAINZ_CLIENT_VERSION}`;

	const response = await fetchMusicBrainz(endpoint);

	if (!response.ok) {
		throw new Error(`MusicBrainz request failed: ${response.status}`);
	}

	const payload = (await response.json()) as MusicBrainzIsrcResponse;
	const recordings = payload.recordings ?? [];

	const candidateDates: string[] = [];
	for (const recording of recordings) {
		const firstDate = recording['first-release-date'] ?? recording.firstReleaseDate;
		if (isFullDate(firstDate)) {
			candidateDates.push(firstDate);
		}

		for (const release of recording.releases ?? recording['release-list'] ?? []) {
			if (isFullDate(release.date)) {
				candidateDates.push(release.date);
			}
		}
	}

	if (candidateDates.length === 0) {
		return null;
	}

	candidateDates.sort();
	return candidateDates[0] ?? null;
}

export async function enrichReleaseDates(
	songs: SongCardData[],
	onProgress?: ProgressHandler
): Promise<SongCardData[]> {
	const total = songs.length;
	const enriched: SongCardData[] = [];

	for (let index = 0; index < songs.length; index += 1) {
		const song = songs[index];
		const releaseDate = await findFirstReleaseDateByIsrc(song.isrc).catch(() => null);

		enriched.push({ ...song, release_date: releaseDate });
		onProgress?.({ current: index + 1, total });

		if (index < songs.length - 1) {
			await sleep(REQUEST_INTERVAL_MS);
		}
	}

	return enriched;
}
