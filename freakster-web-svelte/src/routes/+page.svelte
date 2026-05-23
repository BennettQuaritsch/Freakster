<script lang="ts">
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';

	import { classifyReleaseDate, type DateValidationStatus } from '$lib/date-validation';
	import type { PlaylistJobResponse } from '$lib/types/api';
	import type { SongCardData } from '$lib/types/song-card';
	import type { PageData } from './$types';

	type UiPhase = 'idle' | 'loading' | 'review' | 'error';
	type EditableSong = SongCardData & {
		rowId: string;
	};

	type DateStatusMeta = {
		label: string;
		dot: string;
		text: string;
		inputBorder: string;
	};

	const POLL_INTERVAL_MS = 1200;
	const SPOTIFY_PLAYLIST_PATTERN =
		/^(?:https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/[A-Za-z0-9]+(?:[?#].*)?|spotify:playlist:[A-Za-z0-9]+|[A-Za-z0-9]{22})$/;

	const DATE_STATUS_META: Record<DateValidationStatus, DateStatusMeta> = {
		missing: {
			label: 'Missing',
			dot: 'bg-status-warning',
			text: 'text-status-warning',
			inputBorder: 'border-status-warning/60 focus:border-status-warning'
		},
		incomplete: {
			label: 'Incomplete',
			dot: 'bg-status-caution',
			text: 'text-status-caution',
			inputBorder: 'border-status-caution/60 focus:border-status-caution'
		},
		invalid: {
			label: 'Invalid',
			dot: 'bg-status-error',
			text: 'text-status-error',
			inputBorder: 'border-status-error/70 focus:border-status-error'
		},
		valid: {
			label: 'Valid',
			dot: 'bg-status-success',
			text: 'text-status-success',
			inputBorder: 'border-border-muted focus:border-primary'
		}
	};

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

	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	const isRunning = $derived(phase === 'loading');
	const isValidPlaylistRef = $derived(SPOTIFY_PLAYLIST_PATTERN.test(playlistRef.trim()));
	const hasSongs = $derived(editedSongs.length > 0);
	const songStatuses = $derived(editedSongs.map((song) => classifyReleaseDate(song.release_date)));
	const invalidCount = $derived(songStatuses.filter((status) => status === 'invalid').length);
	const missingCount = $derived(songStatuses.filter((status) => status === 'missing').length);
	const incompleteCount = $derived(songStatuses.filter((status) => status === 'incomplete').length);
	const validCount = $derived(songStatuses.filter((status) => status === 'valid').length);
	const hasInvalidRows = $derived(invalidCount > 0);
	const exportBlocked = $derived(!hasSongs || hasInvalidRows || isPdfExporting);

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

	function updateSongField<K extends 'release_date' | 'song_name' | 'artist_name'>(
		index: number,
		field: K,
		value: EditableSong[K]
	): void {
		editedSongs[index][field] = value;
		editedSongs = [...editedSongs];
		clearExportMessages();
	}

	function getExportValidationError(): string | null {
		if (hasInvalidRows) {
			return 'Fix invalid release dates before exporting. Allowed formats: YYYY-MM-DD, YYYY-MM, YYYY, or blank.';
		}

		if (!hasSongs) {
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
				body: JSON.stringify({ songs: payloadSongs })
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
	<!-- Ambient rose glow, single decorative element -->
	<div
		aria-hidden="true"
		class="pointer-events-none absolute -top-10 left-1/2 h-160 w-160 -translate-x-1/2 rounded-full opacity-40 blur-[120px]"
		style="background: radial-gradient(circle, var(--primary) 0%, transparent 60%);"
	></div>

	<div class="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col px-6 py-8 sm:py-12">
		<!-- Header: wordmark + spotify status -->
		<header class="flex items-start justify-between gap-6">
			<div class="flex items-center gap-3">
				<!-- Mark: waveform glyph -->
				<svg
					viewBox="0 0 32 32"
					fill="currentColor"
					aria-hidden="true"
					class="h-10 w-10 shrink-0 text-primary"
				>
					<path d="M4,13c-0.6,0-1,0.4-1,1v4c0,0.6,0.4,1,1,1s1-0.4,1-1v-4C5,13.4,4.6,13,4,13z" />
					<path d="M8,11c-0.6,0-1,0.4-1,1v8c0,0.6,0.4,1,1,1s1-0.4,1-1v-8C9,11.4,8.6,11,8,11z" />
					<path d="M12,6c-0.6,0-1,0.4-1,1v18c0,0.6,0.4,1,1,1s1-0.4,1-1V7C13,6.4,12.6,6,12,6z" />
					<path d="M16,13c-0.6,0-1,0.4-1,1v4c0,0.6,0.4,1,1,1s1-0.4,1-1v-4C17,13.4,16.6,13,16,13z" />
					<path d="M20,9c-0.6,0-1,0.4-1,1v12c0,0.6,0.4,1,1,1s1-0.4,1-1V10C21,9.4,20.6,9,20,9z" />
					<path d="M24,6c-0.6,0-1,0.4-1,1v18c0,0.6,0.4,1,1,1s1-0.4,1-1V7C25,6.4,24.6,6,24,6z" />
					<path d="M28,13c-0.6,0-1,0.4-1,1v4c0,0.6,0.4,1,1,1s1-0.4,1-1v-4C29,13.4,28.6,13,28,13z" />
				</svg>
				<div class="flex flex-col leading-none">
					<span class="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl"
						>freakster</span
					>
					<span class="mt-1 text-[10px] font-medium tracking-[0.2em] text-text-secondary uppercase">
						vol. {data.version}
					</span>
				</div>
			</div>

			<div class="flex items-center gap-2">
				{#if data.spotifyConnected}
					<span
						class="hidden items-center gap-2 rounded-full border border-status-success/40 bg-status-success-muted px-3 py-1.5 text-xs font-medium text-status-success sm:inline-flex"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-status-success"></span>
						Spotify live
					</span>
					<form method="GET" action={resolve('/auth/spotify')} class="inline-flex">
						<button
							type="submit"
							aria-label="Reconnect Spotify"
							title="Reconnect Spotify"
							class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-muted text-text-secondary transition-colors duration-200 hover:border-primary hover:text-primary"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								class="h-4 w-4"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M3 12a9 9 0 0 1 15.36-6.36M21 12a9 9 0 0 1-15.36 6.36"
								/>
								<path stroke-linecap="round" stroke-linejoin="round" d="M18 3v5h-5M6 21v-5h5" />
							</svg>
						</button>
					</form>
					<form method="POST" action="?/disconnectSpotify" class="inline-flex">
						<button
							type="submit"
							aria-label="Disconnect Spotify"
							title="Disconnect Spotify"
							class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-muted text-text-secondary transition-colors duration-200 hover:border-status-error hover:text-status-error"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								class="h-4 w-4"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12" />
							</svg>
						</button>
					</form>
				{:else}
					<form method="GET" action={resolve('/auth/spotify')} class="inline-flex">
						<input type="hidden" name="force" value="1" />
						<button
							type="submit"
							class="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-text-on-primary transition-colors duration-200 hover:bg-primary-hover active:bg-primary-active"
						>
							Connect Spotify
						</button>
					</form>
				{/if}
			</div>
		</header>

		<!-- Hero copy, only when not in review mode -->
		{#if phase !== 'review'}
			<div class="mt-14 sm:mt-20">
				<p class="font-display text-xs font-medium tracking-[0.25em] text-primary uppercase">
					turn it up
				</p>
				<h1
					class="font-display mt-4 text-5xl leading-[0.95] font-bold tracking-tight text-text-primary sm:text-7xl"
				>
					Your playlist,<br />
					<span class="text-primary">ready to freak.</span>
				</h1>
				<p class="mt-6 max-w-xl text-base leading-relaxed text-text-secondary sm:text-lg">
					Drop a Spotify playlist. We pull the tracks, dig up release dates, and hand you back
					foldable song cards.
				</p>
			</div>
		{/if}

		<!-- Playlist input (idle / loading / error) -->
		{#if phase !== 'review'}
			<section class="mt-10 sm:mt-12">
				<form
					onsubmit={(event) => {
						event.preventDefault();
						void startPlaylistLoad();
					}}
				>
					<label for="playlist-ref" class="sr-only">Spotify playlist URL, URI, or ID</label>
					<div
						class="group flex flex-col gap-3 rounded-2xl border border-border-muted bg-surface-1 p-2 transition-colors duration-200 focus-within:border-primary sm:flex-row sm:items-stretch sm:gap-2"
					>
						<input
							id="playlist-ref"
							type="text"
							bind:value={playlistRef}
							placeholder="paste a spotify playlist url"
							disabled={isRunning || !data.spotifyConnected}
							class="m-1 w-full flex-1 rounded-lg bg-transparent px-4 py-3 text-base text-text-primary outline-none placeholder:text-text-secondary focus:outline-none focus-visible:outline-none disabled:opacity-50 sm:text-lg"
						/>

						<button
							type="submit"
							disabled={isRunning || !data.spotifyConnected || !isValidPlaylistRef}
							class="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-text-on-primary transition-all duration-200 hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-secondary sm:py-4"
						>
							{#if isRunning}
								<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
									<circle
										cx="12"
										cy="12"
										r="9"
										stroke="currentColor"
										stroke-width="2"
										stroke-opacity="0.25"
									/>
									<path
										d="M21 12a9 9 0 0 0-9-9"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
									/>
								</svg>
								Spinning up
							{:else}
								Get freaky
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									class="h-4 w-4"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="m5 12 14 0M13 6l6 6-6 6"
									/>
								</svg>
							{/if}
						</button>
					</div>

					{#if !data.spotifyConnected}
						<p class="mt-3 text-sm text-text-secondary">
							Connect Spotify first, then paste any playlist URL, URI, or ID.
						</p>
					{:else if phase === 'idle'}
						<p class="mt-3 text-sm text-text-secondary">Works with public playlists.</p>
					{/if}
				</form>

				<!-- Progress block, replaces hint when loading -->
				{#if isRunning}
					<div class="mt-6 rounded-2xl border border-border-muted bg-surface-1 p-5">
						<div class="flex items-center justify-between gap-4">
							<div class="flex items-center gap-3">
								<span class="relative flex h-2.5 w-2.5">
									<span
										class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60"
									></span>
									<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary"></span>
								</span>
								<p class="text-sm font-medium text-text-primary">{progressMessage}</p>
							</div>
							{#if progressTotal !== null}
								<p class="font-display text-sm text-text-secondary tabular-nums">
									{progressCurrent} / {progressTotal}
								</p>
							{/if}
						</div>

						<div class="mt-4 h-1 w-full overflow-hidden rounded-full bg-surface-3">
							<div
								class={`h-full rounded-full bg-primary transition-[width] duration-500 ease-out ${progressPercent === null ? 'w-1/3 animate-pulse' : ''}`}
								style={progressPercent !== null
									? `width: ${Math.max(2, Math.min(100, progressPercent))}%`
									: ''}
							></div>
						</div>

						{#if skippedCount > 0}
							<p class="mt-4 text-xs text-status-warning">
								{skippedCount} track{skippedCount === 1 ? '' : 's'} skipped (no Spotify URL).
							</p>
						{/if}
					</div>
				{/if}
			</section>

			<!-- Playlist meta preview while loading -->
			{#if hasPlaylistMetadata && playlistMetadata.name}
				<div class="mt-6 flex items-center gap-4">
					{#if playlistMetadata.imageUrl && !playlistImageUnavailable}
						<img
							src={playlistMetadata.imageUrl}
							alt=""
							onerror={() => {
								playlistImageUnavailable = true;
							}}
							class="h-14 w-14 rounded-lg border border-border-muted object-cover"
						/>
					{:else}
						<div
							class="flex h-14 w-14 items-center justify-center rounded-lg border border-border-muted bg-surface-2"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								class="h-5 w-5 text-text-secondary"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 19V6l12-3v13M9 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-3a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
								/>
							</svg>
						</div>
					{/if}
					<div>
						<p class="text-[10px] font-medium tracking-[0.2em] text-text-secondary uppercase">
							Now loading
						</p>
						<p class="font-display mt-1 text-lg font-semibold text-text-primary">
							{playlistMetadata.name.trim() || 'Untitled playlist'}
						</p>
					</div>
				</div>
			{/if}
		{/if}

		<!-- Error banner -->
		{#if stageError}
			<div
				class="mt-6 flex items-start gap-3 rounded-xl border border-status-error/40 bg-status-error-muted px-4 py-3"
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					class="mt-0.5 h-4 w-4 shrink-0 text-status-error"
				>
					<circle cx="12" cy="12" r="9" />
					<path stroke-linecap="round" d="M12 8v4m0 4h.01" />
				</svg>
				<p class="text-sm leading-relaxed text-status-error">{stageError}</p>
			</div>
		{/if}

		<!-- Review phase: playlist meta + table + export -->
		{#if phase === 'review'}
			<section class="mt-10">
				<!-- Playlist hero: cover + name + counts -->
				<div class="flex flex-col gap-6 sm:flex-row sm:items-end">
					{#if playlistMetadata.imageUrl && !playlistImageUnavailable}
						<img
							src={playlistMetadata.imageUrl}
							alt=""
							onerror={() => {
								playlistImageUnavailable = true;
							}}
							class="h-28 w-28 rounded-xl border border-border-muted object-cover shadow-2xl shadow-black/40 sm:h-32 sm:w-32"
						/>
					{:else}
						<div
							class="flex h-28 w-28 items-center justify-center rounded-xl border border-border-muted bg-surface-2 sm:h-32 sm:w-32"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								class="h-8 w-8 text-text-secondary"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 19V6l12-3v13M9 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-3a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
								/>
							</svg>
						</div>
					{/if}

					<div class="flex-1">
						<p class="font-display text-xs font-medium tracking-[0.25em] text-primary uppercase">
							Side B · pressing
						</p>
						<h2
							class="font-display mt-2 text-3xl leading-tight font-bold text-text-primary sm:text-4xl"
						>
							{playlistMetadata.name?.trim() || 'Untitled playlist'}
						</h2>
						<p class="mt-3 text-sm text-text-secondary">
							{editedSongs.length} track{editedSongs.length === 1 ? '' : 's'} ready. Tighten up the dates,
							then send to print.
						</p>
					</div>
				</div>

				<!-- Status counts -->
				<dl class="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div class="rounded-xl border border-border-muted bg-surface-1 px-4 py-3">
						<dt class="text-[10px] font-medium tracking-[0.2em] text-text-secondary uppercase">
							Valid
						</dt>
						<dd class="mt-1 flex items-baseline gap-2">
							<span class="font-display text-2xl font-bold text-text-primary tabular-nums">
								{validCount}
							</span>
							<span class="h-1.5 w-1.5 rounded-full bg-status-success"></span>
						</dd>
					</div>
					<div class="rounded-xl border border-border-muted bg-surface-1 px-4 py-3">
						<dt class="text-[10px] font-medium tracking-[0.2em] text-text-secondary uppercase">
							Incomplete
						</dt>
						<dd class="mt-1 flex items-baseline gap-2">
							<span class="font-display text-2xl font-bold text-text-primary tabular-nums">
								{incompleteCount}
							</span>
							<span class="h-1.5 w-1.5 rounded-full bg-status-caution"></span>
						</dd>
					</div>
					<div class="rounded-xl border border-border-muted bg-surface-1 px-4 py-3">
						<dt class="text-[10px] font-medium tracking-[0.2em] text-text-secondary uppercase">
							Missing
						</dt>
						<dd class="mt-1 flex items-baseline gap-2">
							<span class="font-display text-2xl font-bold text-text-primary tabular-nums">
								{missingCount}
							</span>
							<span class="h-1.5 w-1.5 rounded-full bg-status-warning"></span>
						</dd>
					</div>
					<div
						class={`rounded-xl border px-4 py-3 ${invalidCount > 0 ? 'border-status-error/50 bg-status-error-muted' : 'border-border-muted bg-surface-1'}`}
					>
						<dt class="text-[10px] font-medium tracking-[0.2em] text-text-secondary uppercase">
							Invalid
						</dt>
						<dd class="mt-1 flex items-baseline gap-2">
							<span
								class={`font-display text-2xl font-bold tabular-nums ${invalidCount > 0 ? 'text-status-error' : 'text-text-primary'}`}
							>
								{invalidCount}
							</span>
							<span class="h-1.5 w-1.5 rounded-full bg-status-error"></span>
						</dd>
					</div>
				</dl>

				<!-- Track list -->
				<div class="mt-8 overflow-hidden rounded-2xl border border-border-muted">
					<div class="overflow-x-auto">
						<table class="min-w-full border-collapse text-sm">
							<thead>
								<tr class="border-b border-border-muted bg-surface-1">
									<th
										class="px-4 py-3 text-left text-[10px] font-semibold tracking-[0.18em] text-text-secondary uppercase"
									>
										Track
									</th>
									<th
										class="px-4 py-3 text-left text-[10px] font-semibold tracking-[0.18em] text-text-secondary uppercase"
									>
										Artist
									</th>
									<th
										class="px-4 py-3 text-left text-[10px] font-semibold tracking-[0.18em] text-text-secondary uppercase"
									>
										Released
									</th>
									<th
										class="px-4 py-3 text-left text-[10px] font-semibold tracking-[0.18em] text-text-secondary uppercase"
									>
										Status
									</th>
								</tr>
							</thead>
							<tbody>
								{#each editedSongs as song, index (song.rowId)}
									{@const status = classifyReleaseDate(song.release_date)}
									{@const meta = DATE_STATUS_META[status]}
									<tr class="border-b border-border-subtle last:border-b-0 hover:bg-surface-1">
										<td class="px-3 py-2 align-middle">
											<input
												type="text"
												value={song.song_name}
												aria-label="Song name"
												oninput={(event) =>
													updateSongField(
														index,
														'song_name',
														(event.currentTarget as HTMLInputElement).value
													)}
												class="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-text-primary transition-colors duration-150 outline-none hover:border-border-muted focus:border-primary focus:bg-surface-2"
											/>
										</td>
										<td class="px-3 py-2 align-middle">
											<input
												type="text"
												value={song.artist_name}
												aria-label="Artist name"
												oninput={(event) =>
													updateSongField(
														index,
														'artist_name',
														(event.currentTarget as HTMLInputElement).value
													)}
												class="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-text-secondary transition-colors duration-150 outline-none hover:border-border-muted focus:border-primary focus:bg-surface-2 focus:text-text-primary"
											/>
										</td>
										<td class="px-3 py-2 align-middle">
											<input
												type="text"
												value={song.release_date ?? ''}
												aria-label="Release date"
												oninput={(event) =>
													updateSongField(
														index,
														'release_date',
														(event.currentTarget as HTMLInputElement).value
													)}
												placeholder="YYYY-MM-DD"
												class={`font-display w-full rounded-md border bg-transparent px-2 py-1.5 text-sm text-text-primary tabular-nums transition-colors duration-150 outline-none focus:bg-surface-2 ${status === 'valid' ? 'border-transparent hover:border-border-muted' : meta.inputBorder}`}
											/>
										</td>
										<td class="px-4 py-2 align-middle">
											<span
												class={`inline-flex items-center gap-2 text-xs font-medium ${meta.text}`}
											>
												<span class={`h-1.5 w-1.5 rounded-full ${meta.dot}`}></span>
												{meta.label}
											</span>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>

				<p class="mt-4 text-xs text-text-secondary">
					Invalid dates block export. Missing or incomplete dates are fine, just flagged.
				</p>

				<!-- Action bar -->
				<div
					class="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border-muted pt-6"
				>
					<button
						type="button"
						onclick={resetWorkflow}
						class="inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-200 hover:text-text-primary"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							class="h-4 w-4"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="m12 19-7-7 7-7M5 12h14" />
						</svg>
						Load another playlist
					</button>

					<div class="flex flex-wrap items-center gap-3">
						<button
							type="button"
							onclick={exportJson}
							disabled={exportBlocked}
							class="inline-flex items-center justify-center gap-2 rounded-xl border border-border-muted px-5 py-3 text-sm font-semibold text-text-primary transition-colors duration-200 hover:border-secondary hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-muted disabled:hover:text-text-primary"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								class="h-4 w-4"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M8 4h13M8 12h13M8 20h13M3 4h.01M3 12h.01M3 20h.01"
								/>
							</svg>
							JSON
						</button>
						<button
							type="button"
							onclick={() => {
								void exportPdf();
							}}
							disabled={exportBlocked}
							class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-text-on-primary transition-all duration-200 hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-secondary"
						>
							{#if isPdfExporting}
								<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
									<circle
										cx="12"
										cy="12"
										r="9"
										stroke="currentColor"
										stroke-width="2"
										stroke-opacity="0.25"
									/>
									<path
										d="M21 12a9 9 0 0 0-9-9"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
									/>
								</svg>
								Pressing
							{:else}
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									class="h-4 w-4"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M12 4v12m0 0 4-4m-4 4-4-4M4 20h16"
									/>
								</svg>
								Print the cards
							{/if}
						</button>
					</div>
				</div>

				{#if exportError}
					<div
						class="mt-4 flex items-start gap-3 rounded-xl border border-status-error/40 bg-status-error-muted px-4 py-3"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							class="mt-0.5 h-4 w-4 shrink-0 text-status-error"
						>
							<circle cx="12" cy="12" r="9" />
							<path stroke-linecap="round" d="M12 8v4m0 4h.01" />
						</svg>
						<p class="text-sm leading-relaxed text-status-error">{exportError}</p>
					</div>
				{/if}

				{#if exportSuccess}
					<div
						class="mt-4 flex items-start gap-3 rounded-xl border border-status-success/40 bg-status-success-muted px-4 py-3"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							class="mt-0.5 h-4 w-4 shrink-0 text-status-success"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" />
						</svg>
						<p class="text-sm leading-relaxed text-status-success">{exportSuccess}</p>
					</div>
				{/if}
			</section>
		{/if}

		<!-- Footer mark -->
		<footer class="mt-auto pt-16">
			<p class="text-[10px] font-medium tracking-[0.2em] text-text-secondary uppercase">
				Pressed in your browser · not affiliated with spotify · not affiliated with hitster
			</p>
		</footer>
	</div>
</main>
