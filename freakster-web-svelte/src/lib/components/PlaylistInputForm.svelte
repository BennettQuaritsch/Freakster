<script lang="ts">
	import type { PlaylistMetadata } from '$lib/types/api';
	import type { UiPhase } from './page-types';

	type Props = {
		playlistRef: string;
		spotifyConnected: boolean;
		isRunning: boolean;
		isValidPlaylistRef: boolean;
		phase: UiPhase;
		progressMessage: string;
		progressPercent: number | null;
		progressCurrent: number;
		progressTotal: number | null;
		skippedCount: number;
		hasPlaylistMetadata: boolean;
		playlistMetadata: PlaylistMetadata;
		playlistImageUnavailable: boolean;
		onsubmit: () => void;
		onImageError: () => void;
	};

	let {
		playlistRef = $bindable(),
		spotifyConnected,
		isRunning,
		isValidPlaylistRef,
		phase,
		progressMessage,
		progressPercent,
		progressCurrent,
		progressTotal,
		skippedCount,
		hasPlaylistMetadata,
		playlistMetadata,
		playlistImageUnavailable,
		onsubmit,
		onImageError
	}: Props = $props();
</script>

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
		Drop a Spotify playlist. We pull the tracks, dig up release dates, and hand you back foldable
		song cards.
	</p>
</div>

<section class="mt-10 sm:mt-12">
	<form
		onsubmit={(event) => {
			event.preventDefault();
			onsubmit();
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
				disabled={isRunning || !spotifyConnected}
				class="m-1 w-full flex-1 rounded-lg bg-transparent px-4 py-3 text-base text-text-primary outline-none placeholder:text-text-secondary focus:outline-none focus-visible:outline-none disabled:opacity-50 sm:text-lg"
			/>

			<button
				type="submit"
				disabled={isRunning || !spotifyConnected || !isValidPlaylistRef}
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
						<path stroke-linecap="round" stroke-linejoin="round" d="m5 12 14 0M13 6l6 6-6 6" />
					</svg>
				{/if}
			</button>
		</div>

		{#if !spotifyConnected}
			<p class="mt-3 text-sm text-text-secondary">
				Connect Spotify first, then paste any playlist URL, URI, or ID.
			</p>
		{:else if phase === 'idle'}
			<p class="mt-3 text-sm text-text-secondary">Works with public playlists.</p>
		{/if}
	</form>

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

{#if hasPlaylistMetadata && playlistMetadata.name}
	<div class="mt-6 flex items-center gap-4">
		{#if playlistMetadata.imageUrl && !playlistImageUnavailable}
			<img
				src={playlistMetadata.imageUrl}
				alt=""
				onerror={onImageError}
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
