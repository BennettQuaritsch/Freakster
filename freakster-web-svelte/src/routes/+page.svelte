<script lang="ts">
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';

	import { classifyReleaseDate } from '$lib/date-validation';
	import Header from '$lib/components/Header.svelte';
	import PlaylistInputForm from '$lib/components/PlaylistInputForm.svelte';
	import ReviewSection from '$lib/components/ReviewSection.svelte';
	import StatusBanner from '$lib/components/StatusBanner.svelte';
	import {
		POLL_INTERVAL_MS,
		SPOTIFY_PLAYLIST_PATTERN,
		type EditableSong,
		type UiPhase
	} from '$lib/components/page-types';
	import type { PlaylistJobResponse } from '$lib/types/api';
	import type { SongCardData } from '$lib/types/song-card';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let playlistRef = $state('');
	let phase = $state<UiPhase>('idle');
	let progressMessage = $state('Paste a Spotify playlist to load and enrich songs.');
	let progressPercent = $state<number | null>(null);
	let progressCurrent = $state(0);
	let progressTotal = $state<number | null>(null);
	let skippedCount = $state(0);
	let hasPlaylistMetadata = $state(false);
	let playlistMetadata = $state<PlaylistJobResponse['playlist']>({ name: null, imageUrl: null });
	let currentPlaylistImageUrl = $state<string | null>(null);
	let playlistImageUnavailable = $state(false);

	let stageError = $state('');
	let exportError = $state('');
	let exportSuccess = $state('');

	let editedSongs = $state<EditableSong[]>([]);
	let isPdfExporting = $state(false);
	let duplex = $state(false);

	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	const isRunning = $derived(phase === 'loading');
	const isValidPlaylistRef = $derived(SPOTIFY_PLAYLIST_PATTERN.test(playlistRef.trim()));
	const hasInvalidRows = $derived(
		editedSongs.some((song) => classifyReleaseDate(song.release_date) === 'invalid')
	);

	$effect(() => {
		if (data.error) {
			stageError = data.error;
			phase = 'error';
		}

		if (data.justConnected && !stageError) {
			progressMessage = 'Spotify connected. Load a playlist to start.';
		}
	});

	function clearPollTimer(): void {
		if (!pollTimer) {
			return;
		}

		clearTimeout(pollTimer);
		pollTimer = null;
	}

	function clearExportMessages(): void {
		exportError = '';
		exportSuccess = '';
	}

	function resetWorkflow(): void {
		clearPollTimer();
		clearExportMessages();
		phase = 'idle';
		playlistRef = '';
		stageError = '';
		editedSongs = [];
		skippedCount = 0;
		hasPlaylistMetadata = false;
		playlistMetadata = { name: null, imageUrl: null };
		currentPlaylistImageUrl = null;
		playlistImageUnavailable = false;
		progressPercent = null;
		progressCurrent = 0;
		progressTotal = null;
		isPdfExporting = false;
		duplex = false;
		progressMessage = data.spotifyConnected
			? 'Spotify connected. Load a playlist to start.'
			: 'Paste a Spotify playlist to load and enrich songs.';
	}

	function toEditableSongs(songs: SongCardData[]): EditableSong[] {
		return songs.map((song, index) => ({
			...song,
			release_date: typeof song.release_date === 'string' ? song.release_date.trim() || null : null,
			rowId: `${song.spotify_url}-${index}`
		}));
	}

	function normalizeSongsForExport(songs: EditableSong[]): SongCardData[] {
		return songs.map((song) => ({
			artist_name: song.artist_name,
			song_name: song.song_name,
			spotify_url: song.spotify_url,
			isrc: song.isrc,
			release_date: song.release_date?.trim() ? song.release_date.trim() : null
		}));
	}

	function updateSongField(
		index: number,
		field: 'song_name' | 'artist_name' | 'release_date',
		value: string
	): void {
		editedSongs[index][field] = value;
		clearExportMessages();
	}

	function getExportValidationError(): string | null {
		if (hasInvalidRows) {
			return 'Fix invalid release dates before exporting. Allowed formats: YYYY-MM-DD, YYYY-MM, YYYY, or blank.';
		}

		if (editedSongs.length === 0) {
			return 'No songs to export yet.';
		}

		return null;
	}

	function downloadBlob(blob: Blob, filename: string): void {
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}

	function getResponseError(payload: unknown, fallback: string): string {
		if (
			payload &&
			typeof payload === 'object' &&
			typeof (payload as { error?: unknown }).error === 'string'
		) {
			return (payload as { error: string }).error;
		}

		return fallback;
	}

	async function startPlaylistLoad(): Promise<void> {
		if (!data.spotifyConnected) {
			phase = 'error';
			stageError = 'Spotify authentication required. Connect Spotify and try again.';
			return;
		}

		if (!playlistRef.trim()) {
			phase = 'error';
			stageError = 'Please enter a Spotify playlist URL, URI, or ID.';
			return;
		}

		clearPollTimer();
		clearExportMessages();
		stageError = '';
		editedSongs = [];
		skippedCount = 0;
		hasPlaylistMetadata = false;
		playlistMetadata = { name: null, imageUrl: null };
		currentPlaylistImageUrl = null;
		playlistImageUnavailable = false;
		progressPercent = 0;
		progressCurrent = 0;
		progressTotal = null;
		progressMessage = 'Submitting playlist job...';
		phase = 'loading';

		try {
			const response = await fetch(resolve('/api/playlist-jobs'), {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ playlistRef: playlistRef.trim() })
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as unknown;
				throw new Error(
					getResponseError(payload, `Could not start playlist job (${response.status}).`)
				);
			}

			const payload = (await response.json()) as { jobId?: string };
			if (!payload.jobId) {
				throw new Error('Playlist job started without a valid job id.');
			}

			progressMessage = 'Downloading songs...';
			await pollPlaylistJob(payload.jobId);
		} catch (error) {
			clearPollTimer();
			phase = 'error';
			stageError = error instanceof Error ? error.message : 'Unexpected playlist job error.';
		}
	}

	function queueNextPoll(jobId: string): void {
		clearPollTimer();
		pollTimer = setTimeout(() => {
			void pollPlaylistJob(jobId);
		}, POLL_INTERVAL_MS);
	}

	async function pollPlaylistJob(jobId: string): Promise<void> {
		try {
			const response = await fetch(resolve(`/api/playlist-jobs/${jobId}`), {
				method: 'GET',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json'
				}
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as unknown;
				throw new Error(
					getResponseError(payload, `Could not fetch playlist progress (${response.status}).`)
				);
			}

			const payload = (await response.json()) as PlaylistJobResponse;
			progressMessage = payload.progress.message;
			progressPercent = payload.progress.percent;
			progressCurrent = payload.progress.current;
			progressTotal = payload.progress.total;
			skippedCount = payload.skippedWithoutSpotifyUrl;
			hasPlaylistMetadata = true;
			playlistMetadata = payload.playlist;

			if (payload.playlist.imageUrl !== currentPlaylistImageUrl) {
				currentPlaylistImageUrl = payload.playlist.imageUrl;
				playlistImageUnavailable = false;
			}

			if (payload.status === 'running') {
				phase = 'loading';
				queueNextPoll(jobId);
				return;
			}

			clearPollTimer();
			if (payload.status === 'error') {
				throw new Error(payload.error ?? 'Playlist processing failed.');
			}

			editedSongs = toEditableSongs(payload.songs ?? []);
			phase = 'review';
			progressMessage =
				editedSongs.length > 0
					? 'Review release dates, fix invalid values, then export.'
					: 'Playlist processed, but no songs were returned.';
		} catch (error) {
			clearPollTimer();
			phase = 'error';
			stageError = error instanceof Error ? error.message : 'Unexpected playlist polling error.';
		}
	}

	async function exportPdf(): Promise<void> {
		clearExportMessages();

		const validationError = getExportValidationError();
		if (validationError) {
			exportError = validationError;
			return;
		}

		isPdfExporting = true;

		try {
			const payloadSongs = normalizeSongsForExport(editedSongs);
			const response = await fetch(resolve('/api/generate-pdf'), {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					songs: payloadSongs,
					playlistName: playlistMetadata.name?.trim() || null,
					duplex
				})
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as unknown;
				throw new Error(getResponseError(payload, `PDF export failed (${response.status}).`));
			}

			const blob = await response.blob();
			const disposition = response.headers.get('content-disposition') ?? '';
			const fileNameMatch = /filename="?([^"]+)"?/i.exec(disposition);
			const filename =
				fileNameMatch?.[1] ?? `song-cards-${new Date().toISOString().slice(0, 10)}.pdf`;

			downloadBlob(blob, filename);

			exportSuccess = 'PDF generated and download started.';
		} catch (error) {
			exportError =
				error instanceof Error ? error.message : 'Unexpected error while exporting PDF.';
		} finally {
			isPdfExporting = false;
		}
	}

	function exportJson(): void {
		clearExportMessages();

		const validationError = getExportValidationError();
		if (validationError) {
			exportError = validationError;
			return;
		}

		try {
			const payloadSongs = normalizeSongsForExport(editedSongs);
			const jsonBlob = new Blob([JSON.stringify(payloadSongs, null, 2)], {
				type: 'application/json'
			});
			downloadBlob(jsonBlob, `song-cards-${new Date().toISOString().slice(0, 10)}.json`);

			exportSuccess = 'JSON exported.';
		} catch (error) {
			exportError =
				error instanceof Error ? error.message : 'Unexpected error while exporting JSON.';
		}
	}

	function markImageUnavailable(): void {
		playlistImageUnavailable = true;
	}

	onDestroy(() => {
		clearPollTimer();
	});
</script>

<svelte:head>
	<title>Freakster — playlists into song cards</title>
	<meta
		name="description"
		content="Turn any Spotify playlist into printable song cards for music games. Connect, paste, review, print."
	/>
</svelte:head>

<main class="relative min-h-svh overflow-hidden">
	<div
		aria-hidden="true"
		class="pointer-events-none absolute -top-10 left-1/2 h-160 w-160 -translate-x-1/2 rounded-full opacity-40 blur-[120px]"
		style="background: radial-gradient(circle, var(--primary) 0%, transparent 60%);"
	></div>

	<div class="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col px-6 py-8 sm:py-12">
		<Header version={data.version} spotifyConnected={data.spotifyConnected} />

		{#if phase !== 'review'}
			<PlaylistInputForm
				bind:playlistRef
				spotifyConnected={data.spotifyConnected}
				{isRunning}
				{isValidPlaylistRef}
				{phase}
				{progressMessage}
				{progressPercent}
				{progressCurrent}
				{progressTotal}
				{skippedCount}
				{hasPlaylistMetadata}
				{playlistMetadata}
				{playlistImageUnavailable}
				onsubmit={() => {
					void startPlaylistLoad();
				}}
				onImageError={markImageUnavailable}
			/>
		{/if}

		{#if stageError}
			<div class="mt-6">
				<StatusBanner tone="error" message={stageError} />
			</div>
		{/if}

		{#if phase === 'review'}
			<ReviewSection
				{playlistMetadata}
				{playlistImageUnavailable}
				{editedSongs}
				{isPdfExporting}
				{exportError}
				{exportSuccess}
				{duplex}
				onUpdate={updateSongField}
				onExportPdf={() => {
					void exportPdf();
				}}
				onExportJson={exportJson}
				onReset={resetWorkflow}
				onImageError={markImageUnavailable}
				onDuplexChange={(value) => {
					duplex = value;
				}}
			/>
		{/if}

		<footer class="mt-auto pt-16">
			<p class="text-[10px] font-medium tracking-[0.2em] text-text-secondary uppercase">
				Pressed in your browser · not affiliated with spotify · not affiliated with hitster
			</p>
		</footer>
	</div>
</main>
