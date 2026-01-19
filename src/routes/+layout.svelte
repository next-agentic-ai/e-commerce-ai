<script lang="ts">
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { enhance } from '$app/forms';
	import { snackbar } from '$lib/stores/snackbar';
	import Snackbar from '$lib/components/Snackbar.svelte';
	import { goto } from '$app/navigation';

	let { children, data } = $props();
	let showMenu = $state(false);

	function toggleMenu() {
		showMenu = !showMenu;
	}

	function closeMenu() {
		showMenu = false;
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<Snackbar />

<div class="min-h-screen flex flex-col bg-gray-50">
	{#if data.user}
		<header class="sticky top-0 z-20 flex h-16 items-center justify-between bg-white px-6 shadow-sm">
			<!-- Left: Logo & Text -->
			<div class="flex items-center gap-3">
				<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white">
					<!-- Simple Sparkles/Star Icon -->
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
					</svg>
				</div>
				<a href="/" class="text-lg font-bold text-gray-900 hover:text-purple-600">AI Creative</a>
			</div>

			<!-- Right: Avatar & Menu -->
			<div class="relative">
				<button 
					onclick={toggleMenu}
					class="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
					aria-label="User menu"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-600">
						<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
						<circle cx="12" cy="7" r="4"/>
					</svg>
				</button>

				{#if showMenu}
					<button 
						class="fixed inset-0 z-30 cursor-default" 
						aria-label="Close menu" 
						tabindex="-1" 
						onclick={closeMenu}
					></button>
					<div class="absolute right-0 top-full mt-2 w-32 rounded-md border border-gray-200 bg-white py-1 shadow-lg z-40">
						<form 
							action="/signout" 
							method="POST" 
							use:enhance={() => {
								closeMenu();
								return async ({ result, update }) => {
									await update();
									if (result.type === 'redirect') {
										snackbar.show('退出成功', 'success');
									}
								};
							}}
						>
							<button 
								type="submit" 
								class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
							>
								退出登录
							</button>
						</form>
					</div>
				{/if}
			</div>
		</header>
	{/if}

	<main class="flex-1 flex flex-col min-h-0">
		{@render children()}
	</main>

	<div style="display:none">
		{#each locales as locale (locale)}
			<a href={localizeHref(page.url.pathname, { locale })}>
				{locale}
			</a>
		{/each}
	</div>
</div>
