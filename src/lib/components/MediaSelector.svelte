<script module lang="ts">
	export interface MediaItem {
		id: string;
		url: string;
		name: string;
		type: 'image' | 'video';
		thumbnail?: string;
		uploading?: boolean; // 标记是否正在上传
	}

	export interface Tab {
		value: string;
		label: string;
	}
</script>

<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	let {
		open = $bindable(false),
		multiple = false,
		maxSelect = 9,
		items = $bindable([] as MediaItem[]),
		initialSelectedIds = [] as string[],
		title = '选择文件',
		tabs = [] as Tab[],
		activeTab = $bindable(''),
		showCloseIcon = false,
		accept = 'image/*',
		onConfirm,
		onUpload = undefined,
		onDelete = undefined,
		canUpload = true,
		canDelete = true
	}: {
		open?: boolean;
		multiple?: boolean;
		maxSelect?: number;
		items?: MediaItem[];
		initialSelectedIds?: string[];
		title?: string;
		tabs?: Tab[];
		activeTab?: string;
		showCloseIcon?: boolean;
		accept?: string;
		onConfirm?: (ids: string[]) => void;
		onUpload?: (files: File[]) => Promise<MediaItem[]>;
		onDelete?: (id: string) => Promise<void>;
		canUpload?: boolean;
		canDelete?: boolean;
	} = $props();

	let searchQuery = $state('');
	let selectedIds = $state<string[]>([]);
	let uploading = $state(false);
	let deletingIds = $state<Set<string>>(new Set());
	
	// Filters for "Popular Videos" tab
	let selectedCategory = $state('all');
	let selectedRegion = $state('us');

	const categories = [
		{ id: 'all', label: '全部类目' },
		{ id: 'home', label: '居家日用' },
		{ id: 'kitchen', label: '厨房用品' },
		{ id: 'textile', label: '家纺布艺' },
		{ id: 'women', label: '女装与女士内衣' },
		{ id: 'shoes', label: '鞋靴' },
		{ id: 'beauty', label: '美妆个护' },
		{ id: 'digital', label: '手机与数码' },
		{ id: 'pets', label: '宠物用品' },
		{ id: 'baby', label: '母婴用品' },
		{ id: 'sports', label: '运动与户外' },
		{ id: 'accessories', label: '时尚配件' },
		{ id: 'bags', label: '箱包' }
	];

	const regions = [
		{ id: 'us', label: '美区' }
	];

	// Derived state for filtered items
	let filteredItems = $derived(
		items.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
	);

	function close() {
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			close();
		}
	}

	function toggleSelection(id: string) {
		if (selectedIds.includes(id)) {
			selectedIds = selectedIds.filter(i => i !== id);
		} else {
			if (!multiple) {
				selectedIds = [id];
			} else {
				if (selectedIds.length < maxSelect) {
					selectedIds = [...selectedIds, id];
				}
			}
		}
	}
	
	function handleConfirm() {
		if (onConfirm) {
			onConfirm(selectedIds);
		}
		close();
	}

	// 处理文件上传
	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;

		const files = Array.from(input.files);
		
		// 验证文件数量
		if (files.length > 9) {
			alert('最多只能上传9张图片');
			input.value = '';
			return;
		}

		// 验证文件大小
		const maxSize = 5 * 1024 * 1024; // 5MB
		for (const file of files) {
			if (file.size > maxSize) {
				alert(`文件 ${file.name} 超过5MB限制`);
				input.value = '';
				return;
			}
		}

		uploading = true;

		// 为每个文件创建占位符，添加到列表前面
		const placeholders: MediaItem[] = files.map((file, index) => ({
			id: `uploading-${Date.now()}-${index}`,
			url: URL.createObjectURL(file), // 使用本地预览
			name: file.name,
			type: 'image' as const,
			uploading: true
		}));

		// 将占位符添加到列表最前面
		items = [...placeholders, ...items];

		try {
			if (onUpload) {
				// 上传文件
				const newItems = await onUpload(files);
				
				if (newItems) {
					// 移除所有占位符
					items = items.filter(item => !item.uploading);
					
					// 将上传成功的图片添加到最前面
					items = [...newItems, ...items];
					
					// 清理占位符的 blob URLs
					placeholders.forEach(placeholder => {
						URL.revokeObjectURL(placeholder.url);
					});
				}
			}
		} catch (error) {
			console.error('Upload error:', error);
			const errorMessage = error instanceof Error ? error.message : '上传失败，请重试';
			alert(errorMessage);
			
			// 上传失败，移除占位符
			items = items.filter(item => !item.uploading);
			
			// 清理占位符的 blob URLs
			placeholders.forEach(placeholder => {
				URL.revokeObjectURL(placeholder.url);
			});
		} finally {
			uploading = false;
			input.value = '';
		}
	}

	// 处理删除
	async function handleDelete(id: string, event: Event, skipConfirm = false) {
		event.stopPropagation(); // 阻止选择事件
		
		if (!skipConfirm && !confirm('确定要删除这张图片吗？')) {
			return;
		}

		deletingIds.add(id);
		deletingIds = deletingIds; // 触发响应式更新

		try {
			if (onDelete) {
				await onDelete(id);
				// 从列表中移除
				items = items.filter(item => item.id !== id);
				// 如果被选中，也从选中列表移除
				selectedIds = selectedIds.filter(i => i !== id);
			}
		} catch (error) {
			console.error('Delete error:', error);
			alert('删除失败，请重试');
		} finally {
			deletingIds.delete(id);
			deletingIds = deletingIds;
		}
	}

    $effect(() => {
        if (open) {
			// Dialog opened - initialize with current selection from parent
			const validItemIds = new Set(items.map(item => item.id));
			selectedIds = initialSelectedIds.filter(id => validItemIds.has(id));
		} else {
            searchQuery = '';
			// Reset filters on close if needed, or keep them.
        }
    });

	// Initialize activeTab if not set and tabs exist
	$effect(() => {
		if (tabs.length > 0 && !activeTab) {
			activeTab = tabs[0].value;
		}
	});

	// Dropdown state
	let showCategoryDropdown = $state(false);
	let showRegionDropdown = $state(false);

	function toggleCategoryDropdown() {
		showCategoryDropdown = !showCategoryDropdown;
		if (showCategoryDropdown) showRegionDropdown = false;
	}

	function toggleRegionDropdown() {
		showRegionDropdown = !showRegionDropdown;
		if (showRegionDropdown) showCategoryDropdown = false;
	}

	function selectCategory(id: string) {
		selectedCategory = id;
		showCategoryDropdown = false;
	}

	function selectRegion(id: string) {
		selectedRegion = id;
		showRegionDropdown = false;
	}

	// Close dropdowns when clicking outside
	function handleClickOutside(e: MouseEvent) {
		// This is a simplified version; in a real app, use an action or check event target
		const target = e.target as HTMLElement;
		if (!target.closest('.custom-dropdown')) {
			showCategoryDropdown = false;
			showRegionDropdown = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

{#if open}
	<!-- Backdrop -->
	<div 
		class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-all"
		onclick={close}
		role="button"
		tabindex="0"
		aria-label="Close modal"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') close(); }}
		transition:fade={{ duration: 200 }}
	></div>

	<!-- Modal Container -->
	<div 
		class="fixed left-1/2 top-1/2 z-50 flex h-[600px] w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-white shadow-2xl focus:outline-none"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		transition:scale={{ start: 0.95, duration: 200 }}
	>
		{#if showCloseIcon}
		<!-- Close Button (Absolute) -->
		<button 
			onclick={close}
            aria-label="Close"
			class="absolute right-4 top-4 z-10 rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none transition-colors cursor-pointer"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M18 6 6 18"/><path d="m6 6 18 18"/>
			</svg>
		</button>
		{/if}

		<!-- Header -->
		{#if tabs.length > 0}
			<div class="flex items-center border-b border-gray-100 px-6 pt-4">
				<div class="flex gap-6">
					{#each tabs as tab}
						<button 
							onclick={() => activeTab = tab.value}
							class="relative pb-3 text-base font-medium transition-colors focus:outline-none cursor-pointer
							{activeTab === tab.value ? 'text-purple-600' : 'text-gray-600 hover:text-gray-900'}"
						>
							{tab.label}
							{#if activeTab === tab.value}
								<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600" transition:scale={{ start: 0, duration: 200, opacity: 1 }}></div>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<div class="flex items-center justify-between border-b border-gray-100 p-5">
				<h2 class="text-lg font-semibold text-gray-900">{title}</h2>
			</div>
		{/if}

		<!-- Toolbar -->
		<div class="bg-gray-50/50 p-5 pb-0">
			<!-- Conditional Toolbar Content based on Tab -->
			{#if activeTab === 'popular'}
				<!-- Popular Videos Filters -->
				<div class="flex items-center gap-4 mb-4">
					<!-- Category Dropdown -->
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium text-gray-700">类目：</span>
						<div class="relative custom-dropdown">
							<button 
								onclick={toggleCategoryDropdown}
								class="flex w-40 items-center justify-between rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 cursor-pointer {showCategoryDropdown ? 'border-purple-500 ring-2 ring-purple-500/20' : ''}"
							>
								<span class="truncate">{categories.find(c => c.id === selectedCategory)?.label}</span>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400 transition-transform {showCategoryDropdown ? 'rotate-180' : ''}">
									<path d="m6 9 6 6 6-6"/>
								</svg>
							</button>
							
							{#if showCategoryDropdown}
								<div 
									transition:scale={{ start: 0.95, duration: 100 }}
									class="absolute left-0 top-full mt-1 w-56 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-lg z-20"
								>
									<div class="max-h-64 overflow-y-auto py-1">
										{#each categories as category}
											<button 
												onclick={() => selectCategory(category.id)}
												class="w-full px-4 py-2 text-left text-sm hover:bg-purple-50 hover:text-purple-700 cursor-pointer
												{selectedCategory === category.id ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-700'}"
											>
												{category.label}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					</div>

					<!-- Region Dropdown -->
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium text-gray-700">地区：</span>
						<div class="relative custom-dropdown">
							<button 
								onclick={toggleRegionDropdown}
								class="flex w-32 items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500/20 cursor-pointer {showRegionDropdown ? 'border-purple-500 ring-2 ring-purple-500/20' : ''}"
							>
								<span class="truncate">{regions.find(r => r.id === selectedRegion)?.label}</span>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400 transition-transform {showRegionDropdown ? 'rotate-180' : ''}">
									<path d="m6 9 6 6 6-6"/>
								</svg>
							</button>

							{#if showRegionDropdown}
								<div 
									transition:scale={{ start: 0.95, duration: 100 }}
									class="absolute left-0 top-full mt-1 w-full overflow-hidden rounded-lg border border-gray-100 bg-white shadow-lg z-20"
								>
									<div class="py-1">
										{#each regions as region}
											<button 
												onclick={() => selectRegion(region.id)}
												class="w-full px-4 py-2 text-left text-sm hover:bg-purple-50 hover:text-purple-700 cursor-pointer
												{selectedRegion === region.id ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-700'}"
											>
												{region.label}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{:else}
				<!-- Standard Toolbar (Search & Delete) -->
				<div class="flex items-center gap-4 rounded-lg p-1 pb-4">
					<!-- Search -->
					<div class="relative flex-1 max-w-md">
						<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400">
								<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
							</svg>
						</div>
						<input 
							type="text" 
							bind:value={searchQuery}
							placeholder="搜索文件名" 
							class="block w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-colors"
						/>
					</div>

					{#if canDelete}
						<!-- Delete Button -->
						<button 
							disabled={selectedIds.length === 0}
							onclick={async () => {
								if (selectedIds.length === 0) return;
								if (!confirm(`确定要删除选中的 ${selectedIds.length} 张图片吗？`)) return;
								
								for (const id of selectedIds) {
									const fakeEvent = new Event('click');
									await handleDelete(id, fakeEvent, true); // skipConfirm = true
								}
							}}
							class="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium transition-colors group ml-auto
							{selectedIds.length > 0 
								? 'text-gray-700 hover:bg-red-50 hover:text-red-600 hover:border-red-100 cursor-pointer' 
								: 'text-gray-300 border-gray-100 cursor-not-allowed'}"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="transition-colors {selectedIds.length > 0 ? 'text-gray-400 group-hover:text-red-500' : 'text-gray-300'}">
								<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
							</svg>
							<span>删除 ({selectedIds.length})</span>
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Main Content Area -->
		<div class="flex-1 overflow-y-auto bg-gray-50/50 p-6 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
			{#if items.length === 0}
				<!-- Empty State -->
				<div class="flex h-full flex-col items-center justify-center text-center">
					<div class="mb-4 flex h-24 w-24 items-center justify-center rounded-2xl bg-gray-100">
						<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-gray-300">
							<path d="M22 13h-4c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h4v-8Z"/><path d="M2 13h4c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H2v-8Z"/><path d="M7 21h10"/><path d="M22 8 12 3 2 8"/><path d="M22 13V8"/><path d="M2 13V8"/>
						</svg>
					</div>
					<h3 class="text-lg font-semibold text-gray-900">暂无文件</h3>
					<p class="mt-1 text-sm text-gray-500">您可以点击下方按钮上传新文件</p>
				</div>
            {:else if filteredItems.length === 0}
                <!-- No Search Results -->
                <div class="flex h-full flex-col items-center justify-center text-center">
                    <p class="text-gray-500">未找到匹配的文件</p>
                </div>
			{:else}
				<!-- Grid of Items -->
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
					{#each filteredItems as item (item.id)}
						<button 
							class="group relative aspect-square overflow-hidden rounded-lg border-2 bg-white transition-all hover:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 cursor-pointer"
							class:border-purple-600={selectedIds.includes(item.id)}
							class:border-transparent={!selectedIds.includes(item.id)}
							class:opacity-50={deletingIds.has(item.id)}
							class:pointer-events-none={item.uploading}
							onclick={() => !item.uploading && toggleSelection(item.id)}
							disabled={deletingIds.has(item.id) || item.uploading}
						>
						{#if item.type === 'video'}
							<!-- Video Thumbnail -->
							<div class="relative h-full w-full bg-gray-900">
								<img src={item.thumbnail || item.url} alt={item.name} class="h-full w-full object-cover opacity-80" />
								<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
									<div class="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm transition-transform group-hover:scale-110">
										<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="currentColor" stroke-width="0" stroke-linecap="round" stroke-linejoin="round" class="ml-0.5">
											<polygon points="5 3 19 12 5 21 5 3" />
										</svg>
									</div>
								</div>
								<div class="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white pointer-events-none">
									VIDEO
								</div>
							</div>
						{:else}
							<!-- Image -->
							<img src={item.url} alt={item.name} class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
							
							<!-- 上传中遮罩 -->
							{#if item.uploading}
								<div class="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
									<svg class="h-8 w-8 animate-spin text-white mb-2" fill="none" viewBox="0 0 24 24">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
									</svg>
									<span class="text-xs text-white font-medium">上传中...</span>
								</div>
							{/if}
						{/if}
							
							<!-- Action Buttons -->
							<div class="absolute right-2 top-2 flex items-center gap-1 z-10">
								{#if canDelete && activeTab !== 'popular' && !item.uploading}
									<!-- Delete Button -->
									<div
										role="button"
										tabindex="0"
										onclick={(e) => handleDelete(item.id, e)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												handleDelete(item.id, e);
											}
										}}
										class="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition-all hover:bg-red-600 group-hover:opacity-100 cursor-pointer"
										class:opacity-50={deletingIds.has(item.id)}
										class:pointer-events-none={deletingIds.has(item.id)}
										aria-label="删除图片"
									>
										{#if deletingIds.has(item.id)}
											<svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
											</svg>
										{:else}
											<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
											</svg>
										{/if}
									</div>
								{/if}
								
								<!-- Checkbox Indicator -->
								{#if !item.uploading}
									<div 
										class="flex h-6 w-6 items-center justify-center rounded-full border transition-colors pointer-events-none"
										class:bg-purple-600={selectedIds.includes(item.id)}
										class:border-purple-600={selectedIds.includes(item.id)}
										class:border-white={selectedIds.includes(item.id)}
										class:bg-black={!selectedIds.includes(item.id)}
										class:bg-opacity-40={!selectedIds.includes(item.id)}
										class:border-white-opacity-50={!selectedIds.includes(item.id)}
									>
										{#if selectedIds.includes(item.id)}
											<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-white">
												<path d="M20 6 9 17l-5-5"/>
											</svg>
										{/if}
									</div>
								{/if}
							</div>
							
							<!-- Name overlay on hover -->
							{#if !item.uploading}
								<div class="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 z-10">
									<p class="truncate text-xs text-white text-left">{item.name}</p>
								</div>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-between border-t border-gray-100 bg-white p-5">
			{#if canUpload && activeTab !== 'popular'}
				<label class="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:text-purple-600 hover:border-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-all cursor-pointer">
					{#if uploading}
						<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
						</svg>
						上传中...
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>
						</svg>
						上传新文件
					{/if}
					<input
						type="file"
						multiple
						{accept}
						class="hidden"
						onchange={handleFileUpload}
						disabled={uploading}
					/>
				</label>
			{:else}
				<div></div>
			{/if}

            <!-- Spacer -->
            <div class="flex-1"></div>

            {#if selectedIds.length > 0}
                <button 
                    onclick={handleConfirm}
                    class="rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 bg-purple-600 text-white hover:bg-purple-700 cursor-pointer"
                    transition:fade={{ duration: 150 }}
                >
                    {multiple ? `确认选择 (${selectedIds.length})` : '确认选择'}
                </button>
            {/if}
		</div>
	</div>
{/if}
