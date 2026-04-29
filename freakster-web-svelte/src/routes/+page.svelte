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
		rowClass: string;
		badgeClass: string;
		inputClass: string;
	};

	const POLL_INTERVAL_MS = 1200;

	const DATE_STATUS_META: Record<DateValidationStatus, DateStatusMeta> = {
		missing: {
			label: 'Missing',
			rowClass: 'bg-amber-950/25',
			badgeClass: 'border border-amber-400/50 bg-amber-400/15 text-amber-200',
			inputClass: 'border-amber-400/50 focus:border-amber-300'
		},
		incomplete: {
			label: 'Incomplete',
			rowClass: 'bg-orange-950/25',
			badgeClass: 'border border-orange-400/50 bg-orange-400/15 text-orange-200',
			inputClass: 'border-orange-400/50 focus:border-orange-300'
		},
		invalid: {
			label: 'Invalid',
			rowClass: 'bg-red-950/25',
			badgeClass: 'border border-red-400/55 bg-red-400/15 text-red-200',
			inputClass: 'border-red-400/60 focus:border-red-300'
		},
		valid: {
			label: 'Valid',
			rowClass: 'bg-slate-900/20',
			badgeClass: 'border border-border-muted bg-surface-3 text-text-on-dark',
			inputClass: 'border-border-muted focus:border-primary'
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
	const hasSongs = $derived(editedSongs.length > 0);
	const songStatuses = $derived(editedSongs.map((song) => classifyReleaseDate(song.release_date)));
	const invalidCount = $derived(songStatuses.filter((status) => status === 'invalid').length);
	const missingCount = $derived(songStatuses.filter((status) => status === 'missing').length);
	const incompleteCount = $derived(songStatuses.filter((status) => status === 'incomplete').length);
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
	<title>Freakster - Spotify Song Cards</title>
	<meta
		name="description"
		content="Load a Spotify playlist, enrich release dates, review them, and export printable song cards."
	/>
</svelte:head>

<main class="min-h-svh bg-bg text-text-on-dark">
	<section class="mx-auto flex min-h-svh w-full max-w-6xl flex-col items-center px-6 py-10">
		<div
			class="my-auto w-full max-w-5xl rounded-3xl border border-border-muted bg-surface-1 p-8 shadow-2xl shadow-black/40"
		>
			<div class="flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 class="text-4xl leading-tight font-black text-primary sm:text-5xl">Freakster</h1>
					<p class="mt-4 max-w-3xl text-sm text-text-on-dark sm:text-base">
						Load playlist songs first, then review and adjust release dates before exporting PDF or
						JSON.
					</p>
				</div>

				<div class="flex items-center gap-2 self-end sm:shrink-0 sm:self-start">
					<span
						class={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap ${
							data.spotifyConnected
								? 'border-emerald-300/40 bg-emerald-900/40 text-emerald-200'
								: 'border-red-300/40 bg-red-900/30 text-red-200'
						}`}
					>
						{data.spotifyConnected ? 'Spotify connected' : 'Spotify disconnected'}
					</span>

					{#if data.spotifyConnected}
						<form method="GET" action={resolve('/auth/spotify')} class="inline-flex">
							<div class="group relative inline-flex">
								<button
									type="submit"
									aria-label="Reconnect Spotify"
									class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-secondary/70 text-secondary transition hover:border-secondary-hover hover:text-secondary-hover"
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
								<span
									class="pointer-events-none absolute top-full left-1/2 z-10 mt-2 -translate-x-1/2 rounded-md border border-border-muted bg-surface-2 px-2 py-1 text-xs whitespace-nowrap text-text-on-dark opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100"
								>
									Reconnect Spotify
								</span>
							</div>
						</form>
						<form method="POST" action="?/disconnectSpotify" class="inline-flex">
							<div class="group relative inline-flex">
								<button
									type="submit"
									aria-label="Disconnect Spotify"
									class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-secondary/60 text-secondary transition hover:border-secondary-hover hover:text-secondary-hover"
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
								<span
									class="pointer-events-none absolute top-full left-1/2 z-10 mt-2 -translate-x-1/2 rounded-md border border-border-muted bg-surface-2 px-2 py-1 text-xs whitespace-nowrap text-text-on-dark opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100"
								>
									Disconnect Spotify
								</span>
							</div>
						</form>
					{:else}
						<form method="GET" action={resolve('/auth/spotify')} class="inline-flex">
							<input type="hidden" name="force" value="1" />
							<div class="group relative inline-flex">
								<button
									type="submit"
									aria-label="Connect Spotify"
									class="inline-flex h-9 items-center justify-center rounded-xl bg-primary px-4 text-xs leading-none font-bold text-text-on-primary transition hover:bg-primary-hover active:bg-primary-active"
								>
									Connect Spotify
								</button>
								<span
									class="pointer-events-none absolute top-full left-1/2 z-10 mt-2 -translate-x-1/2 rounded-md border border-border-muted bg-surface-2 px-2 py-1 text-xs whitespace-nowrap text-text-on-dark opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100"
								>
									Connect Spotify
								</span>
							</div>
						</form>
					{/if}
				</div>
			</div>

			{#if hasPlaylistMetadata}
				<div
					class="mt-6 flex items-center gap-4 rounded-2xl border border-border-muted bg-surface-2 p-4"
				>
					{#if playlistMetadata.imageUrl && !playlistImageUnavailable}
						<img
							src={playlistMetadata.imageUrl}
							alt="Playlist cover"
							onerror={() => {
								playlistImageUnavailable = true;
							}}
							class="h-16 w-16 rounded-xl border border-border-muted object-cover"
						/>
					{:else}
						<div
							class="flex h-16 w-16 items-center justify-center rounded-xl border border-border-muted bg-surface-3 text-xs font-semibold text-text-on-dark"
						>
							No image
						</div>
					{/if}

					<div>
						<p class="text-xs font-semibold tracking-[0.12em] text-slate-400 uppercase">Playlist</p>
						<p class="mt-1 text-lg font-semibold text-text-on-dark">
							{playlistMetadata.name?.trim() || 'Untitled playlist'}
						</p>
					</div>
				</div>
			{/if}

			{#if phase !== 'review'}
				<section class="mt-8 rounded-2xl border border-border-muted bg-surface-2 p-5">
					<h2 class="text-sm font-semibold text-text-on-dark">Load and enrich playlist</h2>
					<form
						class="mt-4"
						onsubmit={(event) => {
							event.preventDefault();
							void startPlaylistLoad();
						}}
					>
						<div class="flex flex-col gap-3 sm:flex-row sm:items-end">
							<label class="block sm:flex-1">
								<span class="mb-2 block text-sm font-medium text-slate-200"
									>Spotify playlist URL / URI / ID</span
								>
								<input
									type="text"
									bind:value={playlistRef}
									placeholder="https://open.spotify.com/playlist/..."
									disabled={isRunning || !data.spotifyConnected}
									class="w-full rounded-xl border border-border-muted bg-surface-3 px-4 py-3 text-sm text-text-on-dark ring-0 outline-none placeholder:text-slate-400 focus:border-primary"
								/>
							</label>

							<button
								type="submit"
								disabled={isRunning || !data.spotifyConnected}
								class="inline-flex w-full items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-bold text-text-on-primary transition hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:bg-border-muted disabled:text-text-on-dark sm:w-auto"
							>
								{isRunning ? 'Loading playlist...' : 'Load playlist'}
							</button>
						</div>
					</form>

					{#if isRunning}
						<div class="mt-5 rounded-xl border border-border-muted bg-surface-3 p-4">
							<div class="flex items-start justify-between gap-4">
								<p class="text-sm font-medium text-text-on-dark">Status</p>
								{#if progressTotal !== null}
									<p class="text-xs text-slate-400">{progressCurrent}/{progressTotal}</p>
								{/if}
							</div>
							<p class="mt-2 text-sm text-text-on-dark">{progressMessage}</p>

							<div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-1">
								<div
									class={`h-full rounded-full bg-primary transition-all duration-500 ${progressPercent === null && isRunning ? 'w-1/3 animate-pulse' : ''}`}
									style={progressPercent !== null
										? `width: ${Math.max(0, Math.min(100, progressPercent))}%`
										: ''}
								></div>
							</div>

							{#if skippedCount > 0}
								<p class="mt-3 text-xs text-amber-200">
									Skipped {skippedCount} track{skippedCount === 1 ? '' : 's'} with no Spotify URL.
								</p>
							{/if}
						</div>
					{/if}
				</section>
			{/if}

			{#if stageError}
				<p
					class="mt-6 rounded-xl border border-red-400/60 bg-red-950/40 px-4 py-3 text-sm text-red-200"
				>
					{stageError}
				</p>
			{/if}

			{#if phase === 'review'}
				<section class="mt-8 rounded-2xl border border-border-muted bg-surface-2 p-5">
					<h2 class="text-sm font-semibold text-text-on-dark">Review and Export</h2>

					<div class="mt-4 flex flex-wrap items-center gap-2 text-xs">
						<span class="rounded-full border border-border-muted px-3 py-1 text-text-on-dark"
							>{editedSongs.length} songs</span
						>
						<span class="rounded-full border border-red-400/50 px-3 py-1 text-red-200"
							>{invalidCount} invalid</span
						>
						<span class="rounded-full border border-orange-400/50 px-3 py-1 text-orange-200"
							>{incompleteCount} incomplete</span
						>
						<span class="rounded-full border border-amber-400/50 px-3 py-1 text-amber-200"
							>{missingCount} missing</span
						>
					</div>

					<div class="mt-4 overflow-x-auto rounded-xl border border-border-muted">
						<table class="min-w-full divide-y divide-border-muted text-sm">
							<thead class="bg-surface-3 text-left text-xs text-text-on-dark uppercase">
								<tr>
									<th class="px-4 py-3">Song</th>
									<th class="px-4 py-3">Artist</th>
									<th class="px-4 py-3">Release date</th>
									<th class="px-4 py-3">Status</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-border-muted/70">
								{#each editedSongs as song, index (song.rowId)}
									{@const status = classifyReleaseDate(song.release_date)}
									{@const meta = DATE_STATUS_META[status]}
									<tr class={meta.rowClass}>
										<td class="px-4 py-3">
											<input
												type="text"
												value={song.song_name}
												oninput={(event) =>
													updateSongField(
														index,
														'song_name',
														(event.currentTarget as HTMLInputElement).value
													)}
												class="w-full rounded-lg border border-border-muted bg-surface-3 px-3 py-2 text-sm text-text-on-dark transition outline-none focus:border-primary"
											/>
										</td>
										<td class="px-4 py-3">
											<input
												type="text"
												value={song.artist_name}
												oninput={(event) =>
													updateSongField(
														index,
														'artist_name',
														(event.currentTarget as HTMLInputElement).value
													)}
												class="w-full rounded-lg border border-border-muted bg-surface-3 px-3 py-2 text-sm text-text-on-dark transition outline-none focus:border-primary"
											/>
										</td>
										<td class="px-4 py-3">
											<input
												type="text"
												value={song.release_date ?? ''}
												oninput={(event) =>
													updateSongField(
														index,
														'release_date',
														(event.currentTarget as HTMLInputElement).value
													)}
												placeholder="YYYY-MM-DD"
												class={`w-full rounded-lg border bg-surface-3 px-3 py-2 text-sm text-text-on-dark transition outline-none ${meta.inputClass}`}
											/>
										</td>
										<td class="px-4 py-3">
											<span
												class={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badgeClass}`}
											>
												{meta.label}
											</span>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<p class="mt-4 text-xs text-text-on-dark">
						Export is blocked only for invalid dates. Missing or incomplete dates are allowed and
						marked as warnings.
					</p>

					<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
						<button
							type="button"
							onclick={resetWorkflow}
							class="secondary-tonal-14 inline-flex items-center justify-center rounded-xl border border-secondary/70 px-5 py-3 text-sm font-semibold text-secondary-hover transition hover:border-secondary-hover hover:text-text-on-dark"
						>
							Load another playlist
						</button>

						<div class="flex flex-wrap items-center gap-3 sm:justify-end">
							<button
								type="button"
								onclick={() => {
									void exportPdf();
								}}
								disabled={exportBlocked}
								class="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-bold text-text-on-primary transition hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:bg-border-muted disabled:text-text-on-dark"
							>
								{isPdfExporting ? 'Generating PDF...' : 'Export PDF'}
							</button>
							<button
								type="button"
								onclick={exportJson}
								disabled={exportBlocked}
								class="secondary-tonal-12 inline-flex items-center justify-center rounded-xl border border-secondary/80 px-5 py-3 text-sm font-semibold text-secondary-hover transition hover:border-secondary-hover hover:text-text-on-dark disabled:cursor-not-allowed disabled:border-border-muted disabled:text-text-on-dark"
							>
								Download JSON
							</button>
						</div>
					</div>

					{#if exportError}
						<p
							class="mt-4 rounded-lg border border-red-400/60 bg-red-950/40 px-3 py-2 text-sm text-red-200"
						>
							{exportError}
						</p>
					{/if}

					{#if exportSuccess}
						<p
							class="mt-4 rounded-lg border border-emerald-400/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200"
						>
							{exportSuccess}
						</p>
					{/if}
				</section>
			{/if}
		</div>
	</section>
</main>

<style>
	:global(main) {
		--focus-halo-fallback: rgba(107, 171, 216, 0.28);
		--secondary-tonal-14-fallback: rgba(148, 163, 184, 0.14);
		--secondary-tonal-22-fallback: rgba(148, 163, 184, 0.22);
		--secondary-tonal-12-fallback: rgba(148, 163, 184, 0.12);
		--secondary-tonal-20-fallback: rgba(148, 163, 184, 0.2);
	}

	:global(main button:focus-visible),
	:global(main input:focus-visible),
	:global(main textarea:focus-visible),
	:global(main select:focus-visible) {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
		box-shadow: 0 0 0 4px var(--focus-halo-fallback);
	}

	@supports (color: color-mix(in srgb, black 50%, white)) {
		:global(main button:focus-visible),
		:global(main input:focus-visible),
		:global(main textarea:focus-visible),
		:global(main select:focus-visible) {
			box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 28%, transparent);
		}

		:global(.secondary-tonal-14) {
			background-color: color-mix(in srgb, var(--secondary) 14%, transparent);
		}

		:global(.secondary-tonal-14:hover) {
			background-color: color-mix(in srgb, var(--secondary) 22%, transparent);
		}

		:global(.secondary-tonal-12) {
			background-color: color-mix(in srgb, var(--secondary) 12%, transparent);
		}

		:global(.secondary-tonal-12:hover) {
			background-color: color-mix(in srgb, var(--secondary) 20%, transparent);
		}
	}

	:global(.secondary-tonal-14) {
		background-color: var(--secondary-tonal-14-fallback);
	}

	:global(.secondary-tonal-14:hover) {
		background-color: var(--secondary-tonal-22-fallback);
	}

	:global(.secondary-tonal-12) {
		background-color: var(--secondary-tonal-12-fallback);
	}

	:global(.secondary-tonal-12:hover) {
		background-color: var(--secondary-tonal-20-fallback);
	}

	:global(main button:focus:not(:focus-visible)),
	:global(main input:focus:not(:focus-visible)),
	:global(main textarea:focus:not(:focus-visible)),
	:global(main select:focus:not(:focus-visible)) {
		outline: none;
		box-shadow: none;
	}
</style>
