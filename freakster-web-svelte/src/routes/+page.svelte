<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy } from 'svelte';

	import type { PageData } from './$types';

	type Phase = 'idle' | 'generating' | 'done' | 'error';

	let { data }: { data: PageData } = $props();
	let playlistRef = $state('');
	let phase = $state<Phase>('idle');
	let errorMessage = $state('');
	let successMessage = $state('Paste a Spotify playlist, then generate your print-ready PDF.');
	let pdfUrl = $state<string | null>(null);
	let downloadName = $state('song-cards-a4.pdf');

	const isRunning = $derived(phase === 'generating');
	const phaseText = $derived.by(() => {
		if (phase === 'error') {
			return errorMessage;
		}

		if (phase === 'done') {
			return successMessage;
		}

		if (phase === 'generating') {
			return 'Server is fetching tracks, release dates, rendering cards, and building your PDF...';
		}

		return successMessage;
	});

	function clearDownload(): void {
		if (pdfUrl) {
			URL.revokeObjectURL(pdfUrl);
		}
		pdfUrl = null;
	}

	onDestroy(() => {
		clearDownload();
	});

	$effect(() => {
		errorMessage = data.error ?? '';
		successMessage = data.justConnected
			? 'Spotify connected. You can generate your PDF now.'
			: 'Paste a Spotify playlist, then generate your print-ready PDF.';
	});

	function resetMessages(): void {
		errorMessage = '';
		successMessage = '';
	}

	function downloadPdf(): void {
		if (!pdfUrl) {
			return;
		}

		const link = document.createElement('a');
		link.href = pdfUrl;
		link.download = downloadName;
		link.click();
	}

	async function generatePdf(): Promise<void> {
		if (!playlistRef.trim()) {
			phase = 'error';
			errorMessage = 'Please enter a Spotify playlist URL, URI, or ID.';
			return;
		}

		clearDownload();
		resetMessages();
		phase = 'generating';

		try {
			const response = await fetch(`${base}/api/generate-pdf`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ playlistRef })
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					error?: string;
					stage?: string;
				} | null;
				const statusPrefix =
					response.status === 500 ? 'Server error' : `Request failed (${response.status})`;
				const stageSuffix = payload?.stage ? ` [stage: ${payload.stage}]` : '';
				throw new Error(
					payload?.error
						? `${statusPrefix}${stageSuffix}: ${payload.error}`
						: `${statusPrefix}${stageSuffix}: Unexpected error while generating PDF on server.`
				);
			}

			const disposition = response.headers.get('content-disposition') ?? '';
			const fileNameMatch = /filename="?([^\"]+)"?/i.exec(disposition);
			downloadName =
				fileNameMatch?.[1] ?? `song-cards-${new Date().toISOString().slice(0, 10)}.pdf`;

			const generatedCount = Number(response.headers.get('x-freakster-card-count') ?? '0');
			const skippedCount = Number(response.headers.get('x-freakster-skipped-count') ?? '0');
			const pdfBlob = await response.blob();

			pdfUrl = URL.createObjectURL(pdfBlob);
			phase = 'done';
			successMessage =
				skippedCount > 0
					? `Generated ${generatedCount} cards and packed them into an A4 PDF. Skipped ${skippedCount} tracks without Spotify URLs.`
					: `Generated ${generatedCount} cards and packed them into an A4 PDF.`;
		} catch (error) {
			phase = 'error';
			errorMessage =
				error instanceof Error ? error.message : 'Unexpected error while generating PDF.';
		}
	}
</script>

<svelte:head>
	<title>Freakster - Spotify Song Cards</title>
	<meta
		name="description"
		content="Generate printable foldable cards from Spotify playlists with QR codes, song title, artist, and release date."
	/>
</svelte:head>

<main
	class="min-h-screen bg-[radial-gradient(80%_100%_at_0%_0%,#44210c_0%,#0f172a_45%,#070b16_100%)] text-slate-100"
>
	<section class="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-10">
		<div
			class="rounded-3xl border border-amber-100/15 bg-slate-950/55 p-8 shadow-2xl shadow-black/40 backdrop-blur"
		>
			<p class="text-xs font-semibold tracking-[0.2em] text-amber-200/80 uppercase">
				Freakster Web
			</p>
			<h1 class="mt-3 text-4xl leading-tight font-black text-amber-50 sm:text-5xl">
				Spotify Playlist to Printable Song Cards
			</h1>
			<p class="mt-4 max-w-2xl text-sm text-slate-300 sm:text-base">
				Enter a playlist link once. The server fetches tracks, finds first release dates, renders
				foldable cards, and returns a print-ready PDF.
			</p>

			<div class="mt-6 flex flex-wrap items-center gap-3">
				{#if data.spotifyConnected}
					<span
						class="inline-flex items-center rounded-full border border-emerald-300/40 bg-emerald-900/40 px-3 py-1 text-xs font-semibold text-emerald-200"
					>
						Spotify connected
					</span>
					<form method="POST" action="?/disconnectSpotify">
						<button
							type="submit"
							class="inline-flex items-center justify-center rounded-xl border border-slate-500 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-amber-300 hover:text-amber-100"
						>
							Disconnect Spotify
						</button>
					</form>
					<form method="GET" action={`${base}/auth/spotify`}>
						<button
							type="submit"
							class="inline-flex items-center justify-center rounded-xl border border-emerald-400/50 px-4 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100"
						>
							Reconnect Spotify
						</button>
					</form>
				{:else}
					<form method="GET" action={`${base}/auth/spotify`}>
						<input type="hidden" name="force" value="1" />
						<button
							type="submit"
							class="inline-flex items-center justify-center rounded-xl bg-emerald-400 px-4 py-2 text-xs font-bold text-emerald-950 transition hover:bg-emerald-300"
						>
							Connect Spotify
						</button>
					</form>
				{/if}
			</div>

			<form
				class="mt-8 space-y-4"
				onsubmit={(event) => {
					event.preventDefault();
					void generatePdf();
				}}
			>
				<label class="block">
					<span class="mb-2 block text-sm font-medium text-slate-200"
						>Spotify playlist URL / URI / ID</span
					>
					<input
						type="text"
						bind:value={playlistRef}
						placeholder="https://open.spotify.com/playlist/..."
						disabled={isRunning || !data.spotifyConnected}
						class="w-full rounded-xl border border-slate-600/70 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 ring-0 outline-none placeholder:text-slate-400 focus:border-amber-300"
					/>
				</label>

				<button
					type="submit"
					disabled={isRunning || !data.spotifyConnected}
					class="inline-flex items-center justify-center rounded-xl bg-amber-200 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
				>
					{isRunning ? 'Generating...' : 'Generate PDF'}
				</button>
			</form>

			<div class="mt-8 rounded-2xl border border-slate-700/80 bg-slate-900/70 p-5">
				<p class="text-sm font-semibold text-slate-100">Status</p>
				<p class="mt-2 text-sm text-slate-300">{phaseText}</p>

				{#if phase === 'error'}
					<p
						class="mt-4 rounded-lg border border-red-400/50 bg-red-950/40 px-3 py-2 text-sm text-red-200"
					>
						{errorMessage}
					</p>
				{/if}

				{#if pdfUrl}
					<button
						type="button"
						onclick={downloadPdf}
						class="mt-4 inline-flex items-center rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-emerald-950 transition hover:bg-emerald-300"
					>
						Download PDF
					</button>
				{/if}
			</div>
		</div>
	</section>
</main>
