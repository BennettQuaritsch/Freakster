<script lang="ts">
	import { resolve } from '$app/paths';

	type Props = {
		version: string;
		spotifyConnected: boolean;
	};

	const { version, spotifyConnected }: Props = $props();
</script>

<header class="flex items-start justify-between gap-6">
	<div class="flex items-center gap-3">
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
				vol. {version}
			</span>
		</div>
	</div>

	<div class="flex items-center gap-2">
		{#if spotifyConnected}
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
