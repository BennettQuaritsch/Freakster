<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { text: string; children: Snippet };
	const { text, children }: Props = $props();
</script>

<div class="group relative inline-flex">
	{@render children()}
	<span
		class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-xs -translate-x-1/2 rounded-xl border border-border-muted bg-surface-3 px-3 py-2 text-xs text-text-secondary opacity-0 transition-opacity duration-150 group-hover:opacity-100"
	>
		{text}
		<span
			class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-surface-3"
		></span>
	</span>
</div>
