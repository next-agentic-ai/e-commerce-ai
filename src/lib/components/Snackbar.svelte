<script lang="ts">
	import { snackbar } from '$lib/stores/snackbar';
	import { fade, fly } from 'svelte/transition';
</script>

{#if $snackbar.isVisible}
	<div
		class="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-3 shadow-lg"
		class:bg-green-100={$snackbar.type === 'success'}
		class:text-green-800={$snackbar.type === 'success'}
		class:border-green-200={$snackbar.type === 'success'}
		class:bg-red-100={$snackbar.type === 'error'}
		class:text-red-800={$snackbar.type === 'error'}
		class:border-red-200={$snackbar.type === 'error'}
		class:bg-blue-100={$snackbar.type === 'info'}
		class:text-blue-800={$snackbar.type === 'info'}
		class:border-blue-200={$snackbar.type === 'info'}
		class:border={$snackbar.type !== 'info'}
		transition:fly={{ y: -20, duration: 300 }}
	>
		{#if $snackbar.type === 'success'}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
				<polyline points="22 4 12 14.01 9 11.01" />
			</svg>
		{:else if $snackbar.type === 'error'}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
		{:else}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="16" x2="12" y2="12" />
				<line x1="12" y1="8" x2="12.01" y2="8" />
			</svg>
		{/if}
		<span class="text-sm font-medium">{$snackbar.message}</span>
	</div>
{/if}

