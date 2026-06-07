<script lang="ts">
	import { classifyReleaseDate } from '$lib/date-validation';
	import type { PlaylistMetadata } from '$lib/types/api';

	import StatusBanner from './StatusBanner.svelte';
	import { DATE_STATUS_META, type EditableSong } from './page-types';

	type SongField = 'song_name' | 'artist_name' | 'release_date';

	type Props = {
		playlistMetadata: PlaylistMetadata;
		playlistImageUnavailable: boolean;
		editedSongs: EditableSong[];
		isPdfExporting: boolean;
		exportError: string;
		exportSuccess: string;
		duplex: boolean;
		onUpdate: (index: number, field: SongField, value: string) => void;
		onExportPdf: () => void;
		onExportJson: () => void;
		onReset: () => void;
		onImageError: () => void;
		onDuplexChange: (value: boolean) => void;
	};

	const {
		playlistMetadata,
		playlistImageUnavailable,
		editedSongs,
		isPdfExporting,
		exportError,
		exportSuccess,
		duplex,
		onUpdate,
		onExportPdf,
		onExportJson,
		onReset,
		onImageError,
		onDuplexChange
	}: Props = $props();

	const songStatuses = $derived(editedSongs.map((song) => classifyReleaseDate(song.release_date)));
	const validCount = $derived(songStatuses.filter((status) => status === 'valid').length);
	const incompleteCount = $derived(songStatuses.filter((status) => status === 'incomplete').length);
	const missingCount = $derived(songStatuses.filter((status) => status === 'missing').length);
	const invalidCount = $derived(songStatuses.filter((status) => status === 'invalid').length);
	const exportBlocked = $derived(editedSongs.length === 0 || invalidCount > 0 || isPdfExporting);
</script>

<section class="mt-10">
	<div class="flex flex-col gap-6 sm:flex-row sm:items-end">
		{#if playlistMetadata.imageUrl && !playlistImageUnavailable}
			<img
				src={playlistMetadata.imageUrl}
				alt=""
				onerror={onImageError}
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
			<h2 class="font-display mt-2 text-3xl leading-tight font-bold text-text-primary sm:text-4xl">
				{playlistMetadata.name?.trim() || 'Untitled playlist'}
			</h2>
			<p class="mt-3 text-sm text-text-secondary">
				{editedSongs.length} track{editedSongs.length === 1 ? '' : 's'} ready. Tighten up the dates, then
				send to print.
			</p>
		</div>
	</div>

	<dl class="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="rounded-xl border border-border-muted bg-surface-1 px-4 py-3">
			<dt class="text-[10px] font-medium tracking-[0.2em] text-text-secondary uppercase">Valid</dt>
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
						{@const status = songStatuses[index]}
						{@const meta = DATE_STATUS_META[status]}
						<tr class="border-b border-border-subtle last:border-b-0 hover:bg-surface-1">
							<td class="px-3 py-2 align-middle">
								<input
									type="text"
									value={song.song_name}
									aria-label="Song name"
									oninput={(event) =>
										onUpdate(index, 'song_name', (event.currentTarget as HTMLInputElement).value)}
									class="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-text-primary transition-colors duration-150 outline-none hover:border-border-muted focus:border-primary focus:bg-surface-2"
								/>
							</td>
							<td class="px-3 py-2 align-middle">
								<input
									type="text"
									value={song.artist_name}
									aria-label="Artist name"
									oninput={(event) =>
										onUpdate(index, 'artist_name', (event.currentTarget as HTMLInputElement).value)}
									class="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-text-secondary transition-colors duration-150 outline-none hover:border-border-muted focus:border-primary focus:bg-surface-2 focus:text-text-primary"
								/>
							</td>
							<td class="px-3 py-2 align-middle">
								<input
									type="text"
									value={song.release_date ?? ''}
									aria-label="Release date"
									oninput={(event) =>
										onUpdate(
											index,
											'release_date',
											(event.currentTarget as HTMLInputElement).value
										)}
									placeholder="YYYY-MM-DD"
									class={`font-display w-full rounded-md border bg-transparent px-2 py-1.5 text-sm text-text-primary tabular-nums transition-colors duration-150 outline-none focus:bg-surface-2 ${status === 'valid' ? 'border-transparent hover:border-border-muted' : meta.inputBorder}`}
								/>
							</td>
							<td class="px-4 py-2 align-middle">
								<span class={`inline-flex items-center gap-2 text-xs font-medium ${meta.text}`}>
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

	<div
		class="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border-muted pt-6"
	>
		<button
			type="button"
			onclick={onReset}
			class="inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-200 hover:text-text-primary"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
				<path stroke-linecap="round" stroke-linejoin="round" d="m12 19-7-7 7-7M5 12h14" />
			</svg>
			Load another playlist
		</button>

		<div class="flex flex-wrap items-center gap-3">
			<label
				class="inline-flex cursor-pointer select-none items-center gap-2 rounded-xl border border-border-muted px-4 py-3 text-sm font-medium text-text-secondary transition-colors duration-200 hover:border-primary hover:text-text-primary"
			>
				<input
					type="checkbox"
					checked={duplex}
					onchange={(event) => onDuplexChange((event.currentTarget as HTMLInputElement).checked)}
					class="h-4 w-4 cursor-pointer accent-primary"
				/>
				<span>Double-sided Print</span>
			</label>
			<button
				type="button"
				onclick={onExportJson}
				disabled={exportBlocked}
				class="inline-flex items-center justify-center gap-2 rounded-xl border border-border-muted px-5 py-3 text-sm font-semibold text-text-primary transition-colors duration-200 hover:border-secondary hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-muted disabled:hover:text-text-primary"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
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
				onclick={onExportPdf}
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
		<div class="mt-4">
			<StatusBanner tone="error" message={exportError} />
		</div>
	{/if}

	{#if exportSuccess}
		<div class="mt-4">
			<StatusBanner tone="success" message={exportSuccess} />
		</div>
	{/if}
</section>
