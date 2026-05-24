<script lang="ts">
	type Props = {
		tone: 'error' | 'success';
		message: string;
	};

	const { tone, message }: Props = $props();
</script>

{#if tone === 'error'}
	<div
		class="flex items-start gap-3 rounded-xl border border-status-error/40 bg-status-error-muted px-4 py-3"
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
		<p class="text-sm leading-relaxed text-status-error">{message}</p>
	</div>
{:else}
	<div
		class="flex items-start gap-3 rounded-xl border border-status-success/40 bg-status-success-muted px-4 py-3"
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
		<p class="text-sm leading-relaxed text-status-success">{message}</p>
	</div>
{/if}
