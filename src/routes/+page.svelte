<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { snackbar } from '$lib/stores/snackbar';
	import MediaSelector, { type MediaItem } from '$lib/components/MediaSelector.svelte';

	let { data } = $props();

	let isGenerating = $state(false);

    // Generation Mode
    let generationMode = $state<'image' | 'ad_video'>('ad_video');
    let imageGenerationCount = $state(1);
    let imageGenerationSize = $state('1:1');
    let imageGenerationLanguage = $state('zh');

    // Ad Video Configuration
    let adVideoAspectRatio = $state('9:16');

	// Image Selection State
	let showImageSelector = $state(false);
	let selectedImageIds = $state<string[]>([]);
	
	// 从服务器加载的产品图片
	let availableImages = $derived.by(() => {
		const pageData = data as any;
		if (pageData?.images) {
			return pageData.images.map((img: any) => ({
				id: img.id,
				url: img.url,
				name: img.name,
				type: 'image' as const
			}));
		}
		return [];
	});
	
	// 任务列表
	let tasks = $derived((data as any)?.tasks || []);
	
	// Derived state to get the actual image objects for display
	let selectedImages = $derived(
		availableImages.filter((img: MediaItem) => selectedImageIds.includes(img.id))
	);

	function handleOpenImageSelector() {
		// 从服务器加载实际的产品图片
		showImageSelector = true;
	}

	async function handleImageUpload(files: File[]): Promise<MediaItem[]> {
		try {
			const formData = new FormData();
			
			// 添加文件
			files.forEach((file) => {
				formData.append('images', file);
			});

			// 获取图片元数据
			const metadata = await Promise.all(
				files.map((file) => getImageDimensions(URL.createObjectURL(file)))
			);
			formData.append('imageMetadata', JSON.stringify(metadata));

			// 上传到服务器
			const response = await fetch('?/upload', {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				throw new Error('Upload failed');
			}
			
			// 使用 SvelteKit 的 deserialize 来解析响应
			const result = deserialize(await response.text());
			console.log('Upload response:', result);
			
			if (result.type === 'success' && result.data) {
				const actionData = result.data as any;
				
				if (actionData.success && Array.isArray(actionData.images)) {
					// 将服务器返回的图片转换为 MediaItem 格式
					const newItems: MediaItem[] = actionData.images.map((img: any) => ({
						id: img.id,
						url: img.url,
						name: img.name, // 使用数据库中保存的名字
						type: 'image' as const
					}));
					
					return newItems;
				}
			}
			
			// 如果是错误响应
			if (result.type === 'failure') {
				const errorData = result.data as any;
				throw new Error(errorData?.error || 'Upload failed');
			}
			
			console.error('Unexpected response format:', result);
			throw new Error('Upload response invalid');
		} catch (error) {
			console.error('Upload error:', error);
			throw error;
		}
	}

	async function handleImageDelete(id: string) {
		try {
			const formData = new FormData();
			formData.append('imageId', id);

			const response = await fetch('?/delete', {
				method: 'POST',
				body: formData
			});

			if (!response.ok) throw new Error('Delete failed');
		} catch (error) {
			console.error('Delete error:', error);
			throw error;
		}
	}

	function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				resolve({ width: img.width, height: img.height });
				URL.revokeObjectURL(url);
			};
			img.onerror = () => {
				resolve({ width: 0, height: 0 });
				URL.revokeObjectURL(url);
			};
			img.src = url;
		});
	}

	function handleImageSelection(ids: string[]) {
		selectedImageIds = ids;
	}

	function removeImage(id: string) {
		selectedImageIds = selectedImageIds.filter(i => i !== id);
	}

	const languages = [
		{ id: 'zh', label: '中文 (普通话)' },
		{ id: 'en', label: '英语' },
		{ id: 'es', label: '西班牙语' },
		{ id: 'hi', label: '印地语' },
		{ id: 'ar', label: '阿拉伯语' },
		{ id: 'pt', label: '葡萄牙语' },
		{ id: 'ru', label: '俄语' },
		{ id: 'ja', label: '日语' }
	];

	// 重置表单到默认状态
	function resetForm() {
		selectedImageIds = [];
		// 图片生成默认值
		imageGenerationCount = 1;
		imageGenerationSize = '1:1';
		imageGenerationLanguage = 'zh';
		// 广告视频默认值
		adVideoAspectRatio = '9:16';
	}

	// 生成视频/图片
	async function handleGenerate() {
		if (selectedImageIds.length === 0) {
			alert('请先选择产品图片');
			return;
		}

		isGenerating = true;

		try {
            if (generationMode === 'ad_video') {
                // 广告视频生成逻辑
                if (selectedImageIds.length !== 1) {
                    alert('广告视频只支持上传1张产品图片');
                    isGenerating = false;
                    return;
                }

                const formData = new FormData();
                formData.append('imageIds', JSON.stringify(selectedImageIds));
                formData.append('aspectRatio', adVideoAspectRatio);

                const response = await fetch('?/generateAdVideo', {
                    method: 'POST',
                    body: formData
                });

                const result = deserialize(await response.text());

                if (result.type === 'success' && result.data) {
                    const actionData = result.data as any;
                    if (actionData.success) {
                        snackbar.show('广告视频生成任务已创建！请在任务列表中查看进度', 'success');
                        resetForm();
                        await invalidateAll();
                    } else {
                        alert(actionData.error || '创建任务失败');
                    }
                } else if (result.type === 'failure') {
                    const errorData = result.data as any;
                    alert(errorData?.error || '创建任务失败');
                }
            } else {
                // 图片生成逻辑
                const formData = new FormData();
                formData.append('imageIds', JSON.stringify(selectedImageIds));
                formData.append('aspectRatio', imageGenerationSize);
                formData.append('language', imageGenerationLanguage);
                formData.append('imageCount', imageGenerationCount.toString());

                const response = await fetch('?/generateImage', {
                    method: 'POST',
                    body: formData
                });

                const result = deserialize(await response.text());

                if (result.type === 'success' && result.data) {
                    const actionData = result.data as any;
                    if (actionData.success) {
                        snackbar.show('宣传图生成任务已创建！请在任务列表中查看进度', 'success');
                        resetForm();
                        await invalidateAll();
                    } else {
                        alert(actionData.error || '创建任务失败');
                    }
                } else if (result.type === 'failure') {
                    const errorData = result.data as any;
                    alert(errorData?.error || '创建任务失败');
                }
            }
		} catch (error) {
			console.error('Generate error:', error);
			alert('创建任务失败，请重试');
		} finally {
			isGenerating = false;
		}
	}

	// 刷新任务列表
	async function handleRefresh() {
		await invalidateAll();
	}

	// 格式化状态文本
	function formatStatus(status: string): { text: string; color: string } {
		const statusMap: Record<string, { text: string; color: string }> = {
			pending: { text: '等待中', color: 'text-gray-600' },
			running: { text: '生成中', color: 'text-blue-600' },
			completed: { text: '已完成', color: 'text-green-600' },
			failed: { text: '失败', color: 'text-red-600' }
		};
		return statusMap[status] || { text: status, color: 'text-gray-600' };
	}

	// 格式化时间
	function formatTime(date: Date | string): string {
		const d = typeof date === 'string' ? new Date(date) : date;
		const now = new Date();
		const diff = now.getTime() - d.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}天前`;
		if (hours > 0) return `${hours}小时前`;
		if (minutes > 0) return `${minutes}分钟前`;
		return '刚刚';
	}

	// 判断任务类型
	function getTaskType(task: any): 'image' | 'ad_video' {
		return task.taskType || 'image';
	}

	// 获取任务结果URLs
	function getTaskResultUrls(task: any): string[] {
		const type = getTaskType(task);
		if (type === 'image' && task.images?.length) {
			return task.images.map((img: any) => `/storage/${img.path}`).filter(Boolean);
		}
		if (type === 'ad_video' && task.adFinalVideos?.length) {
			return task.adFinalVideos.map((v: any) => `/storage/${v.path}`).filter(Boolean);
		}
		return [];
	}

	// 查看生成结果
	let previewDialog = $state<{ open: boolean; type: 'image' | 'ad_video'; urls: string[] }>({
		open: false,
		type: 'ad_video',
		urls: []
	});

	function handlePreview(task: any) {
		const urls = getTaskResultUrls(task);
		if (urls.length > 0) {
			const taskType = getTaskType(task);
			previewDialog = {
				open: true,
				type: taskType,
				urls
			};
		}
	}

	function closePreview() {
		previewDialog.open = false;
	}

</script>

<div class="flex h-[calc(100vh-64px)] bg-gray-50">
	<!-- Left Sidebar: Configuration -->
	<div class="w-[460px] flex flex-col border-r border-gray-200 bg-white">
        <!-- Mode Tabs -->
        <div class="flex border-b border-gray-200 sticky top-0 bg-white z-10">
            <button 
                type="button"
                class="flex-1 py-3 text-sm font-medium text-center transition-colors {generationMode === 'ad_video' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500 hover:text-gray-700'}"
                onclick={() => generationMode = 'ad_video'}
            >
                广告视频
            </button>
            <button 
                type="button"
                class="flex-1 py-3 text-sm font-medium text-center transition-colors {generationMode === 'image' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500 hover:text-gray-700'}"
                onclick={() => generationMode = 'image'}
            >
                宣传图生成
            </button>
        </div>

		<div class="flex-1 overflow-y-auto p-6 space-y-6">
			<!-- Product Images -->
			<div>
				<div class="flex items-center justify-between mb-2">
					<span class="text-sm font-medium text-gray-900">
						<span class="text-red-500">*</span> 产品图片
					</span>
					<span class="text-xs text-gray-400">{selectedImages.length}/{generationMode === 'ad_video' ? 1 : 9}</span>
				</div>
				<p class="text-xs text-gray-500 mb-2">
					{#if generationMode === 'ad_video'}
						上传1张产品图片，系统将自动分析产品并生成广告视频
					{:else}
						建议提交产品各个角度的图片，最多上传9张
					{/if}
				</p>
				<div class="grid grid-cols-3 gap-2">
					<!-- Selected Images -->
					{#each selectedImages as image (image.id)}
						<div class="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
							<img src={image.url} alt={image.name} class="h-full w-full object-cover" />
							<button
								type="button"
								aria-label="Remove image"
								onclick={() => removeImage(image.id)}
								class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-all hover:bg-black/80 group-hover:opacity-100 cursor-pointer"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M18 6 6 18"/><path d="M6 6 18 18"/>
								</svg>
							</button>
						</div>
					{/each}

					<!-- Add Button (only if less than max) -->
					{#if selectedImages.length < (generationMode === 'ad_video' ? 1 : 9)}
						<button 
							type="button"
							aria-label="Select product image"
							onclick={handleOpenImageSelector}
							class="aspect-square flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 hover:bg-gray-50 hover:border-gray-400 transition-colors cursor-pointer"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400 mb-1">
								<path d="M5 12h14"/>
								<path d="M12 5v14"/>
							</svg>
							<span class="text-xs text-gray-500">选择</span>
						</button>
					{/if}
				</div>
			</div>

			<!-- Generation Configuration -->
			<div>
				<h3 class="text-sm font-bold text-gray-900 mb-3">生成配置</h3>
				<div class="space-y-3">
                    {#if generationMode === 'ad_video'}
                        <!-- Ad Video Configuration -->
                        <div>
                            <label for="ad-video-ratio-select" class="block text-xs text-gray-500 mb-1">视频比例</label>
                            <div class="relative">
                                <select
                                    id="ad-video-ratio-select"
                                    bind:value={adVideoAspectRatio}
                                    class="block w-full rounded-md border-gray-300 py-1.5 pl-3 pr-8 text-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500 border appearance-none bg-none"
                                >
                                    <option value="9:16">竖屏 (9:16)</option>
                                    <option value="16:9">横屏 (16:9)</option>
                                </select>
                                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Ad Video Workflow Description -->
                        <div class="bg-purple-50 rounded-lg p-3 space-y-1.5">
                            <p class="text-xs font-medium text-purple-700">广告视频生成流程</p>
                            <div class="space-y-1 text-xs text-purple-600">
                                <p>1. AI 分析产品特征</p>
                                <p>2. 生成广告文案（标题 + 正文 + CTA + BGM风格标签）</p>
                                <p>3. 设计4个连续分镜画面（每个2-4秒）</p>
                                <p>4. 生成2×2分镜图并切分为4张关键帧</p>
                                <p>5. 基于首帧生成4个视频片段</p>
                                <p>6. TTS 语音合成 + BGM搜索下载 + 音视频合成</p>
                            </div>
                        </div>
                    {:else}
                         <!-- Image Configuration -->
                         <div class="grid grid-cols-2 gap-3">
                            <!-- Image Size -->
                            <div>
                                <label for="image-size-select" class="block text-xs text-gray-500 mb-1">尺寸</label>
                                <div class="relative">
                                    <select
                                        id="image-size-select"
                                        bind:value={imageGenerationSize}
                                        class="block w-full rounded-md border-gray-300 py-1.5 pl-3 pr-8 text-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500 border appearance-none bg-none"
                                    >
                                        <option value="1:1">方形 (1:1)</option>
                                    </select>
                                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Image Language -->
                            <div>
                                <label for="image-language-select" class="block text-xs text-gray-500 mb-1">语言</label>
                                <div class="relative">
                                    <select
                                        id="image-language-select"
                                        bind:value={imageGenerationLanguage}
                                        class="block w-full rounded-md border-gray-300 py-1.5 pl-3 pr-8 text-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500 border appearance-none bg-none"
                                    >
                                        {#each languages as lang (lang.id)}
                                            <option value={lang.id}>{lang.label}</option>
                                        {/each}
                                    </select>
                                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </div>
                            </div>
                         </div>
                    {/if}

					<!-- Quantity (for image mode only) -->
                    {#if generationMode === 'image'}
					<div>
						<label for="image-quantity-input" class="block text-xs text-gray-500 mb-1">数量</label>
						<div class="relative">
							<input
								id="image-quantity-input"
								type="number"
								min="1"
								bind:value={imageGenerationCount}
								class="block w-full rounded-md border-gray-300 py-1.5 pl-3 pr-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500 border appearance-none"
							/>
						</div>
					</div>
                    {/if}
				</div>
			</div>
		</div>

		<!-- Bottom Action Bar -->
		<div class="border-t border-gray-200 p-4 bg-white">
			<button 
				onclick={handleGenerate}
				disabled={isGenerating || selectedImageIds.length === 0}
				class="w-full flex items-center justify-center gap-2 rounded-lg bg-purple-600 py-3 text-white font-medium hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{#if isGenerating}
					<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					生成中...
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0">
						<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
					</svg>
					生成
				{/if}
			</button>
		</div>
	</div>

	<!-- Right Content: Task List -->
	<div class="flex-1 flex flex-col min-w-0 bg-white">
		<div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
			<h2 class="text-lg font-bold text-gray-900">任务列表</h2>
			<button 
				type="button"
				aria-label="Refresh task list"
				onclick={handleRefresh}
				class="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
					<path d="M3 3v5h5"/>
					<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
					<path d="M16 16l5 5v-5"/>
				</svg>
			</button>
		</div>

		{#if tasks.length === 0}
			<div class="flex-1 flex flex-col items-center justify-center p-8 text-center">
				<div class="mb-4 rounded-2xl bg-gray-50 p-6">
					<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400">
						<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
						<path d="M9 3v18"/>
						<path d="m14 9 4 3-4 3V9Z"/>
					</svg>
				</div>
				<h3 class="text-lg font-medium text-gray-900 mb-1">暂无任务记录</h3>
				<p class="text-gray-500">创建您的第一个AI生成任务</p>
			</div>
		{:else}
			<div class="flex-1 overflow-y-auto p-6">
				<div class="space-y-4">
					{#each tasks as task (task.id)}
						{@const taskType = getTaskType(task)}
						<div class="rounded-lg border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
							<div class="flex items-start justify-between mb-3">
								<div class="flex-1">
									<div class="flex items-center gap-2 mb-1">
										<!-- 任务类型标签 -->
										<span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${taskType === 'ad_video' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
											{#if taskType === 'ad_video'}
												<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
													<rect width="18" height="14" x="3" y="5" rx="2" ry="2" />
													<path d="M3 10h18" />
													<path d="m8 5 3 5" />
													<path d="m15 5 3 5" />
												</svg>
												广告视频
											{:else}
												<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
													<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
													<circle cx="9" cy="9" r="2"/>
													<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
												</svg>
												图片
											{/if}
										</span>
										<span class={`text-sm font-medium ${formatStatus(task.status).color}`}>
											{formatStatus(task.status).text}
										</span>
										<span class="text-xs text-gray-400">
											{formatTime(task.createdAt)}
										</span>
									</div>
									<div class="flex items-center gap-2 text-xs text-gray-500">
										<span>{task.aspectRatio}</span>
										{#if taskType === 'ad_video'}
											<span>•</span>
											<span>广告视频</span>
										{:else}
											<span>•</span>
											<span>{task.imageCount || 1}张图片</span>
										{/if}
									</div>
								</div>
								
								{#if task.status === 'running'}
									<div class="flex items-center gap-2 text-blue-600">
										<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
										<span class="text-xs">处理中</span>
									</div>
								{/if}
							</div>

							{#if task.status === 'completed'}
								{@const urls = getTaskResultUrls(task)}
								{#if urls.length > 0}
									<div class="mt-3">
										{#if taskType === 'ad_video'}
											<div class="grid grid-cols-1 gap-3 max-w-md">
												{#each urls as url}
													<!-- svelte-ignore a11y_media_has_caption -->
													<video 
														src={url} 
														controls 
														class="w-full aspect-video rounded-lg bg-black border border-gray-200"
														preload="metadata"
													>
														您的浏览器不支持视频播放
													</video>
												{/each}
											</div>
										{:else}
											<div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
												{#each urls as url, i}
													<button 
														type="button"
														class="relative aspect-square rounded-lg overflow-hidden border border-gray-200 group cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-purple-500"
														onclick={() => handlePreview(task)}
														aria-label={`查看图片 ${i+1}`}
													>
														<img src={url} alt={`结果 ${i+1}`} class="w-full h-full object-cover transition-transform group-hover:scale-105" />
													</button>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							{/if}

							{#if task.errorMessage}
								<div class="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
									{task.errorMessage}
								</div>
							{/if}

							{#if task.completedAt}
								<div class="mt-2 text-xs text-gray-400">
									完成于 {new Date(task.completedAt).toLocaleString('zh-CN')}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Image Selector -->
<MediaSelector 
	bind:open={showImageSelector}
	bind:items={availableImages}
	initialSelectedIds={selectedImageIds}
	title="选择产品图片"
	multiple={generationMode !== 'ad_video'}
	maxSelect={generationMode === 'ad_video' ? 1 : 9}
	accept="image/*"
	canUpload={true}
	canDelete={true}
	onConfirm={handleImageSelection}
	onUpload={handleImageUpload}
	onDelete={handleImageDelete}
/>

<!-- Preview Dialog -->
{#if previewDialog.open}
	<div 
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
		onclick={closePreview}
		onkeydown={(e) => e.key === 'Escape' && closePreview()}
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div 
			role="document"
			class="relative bg-white rounded-lg shadow-xl max-w-5xl max-h-[90vh] overflow-hidden"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
				<h3 class="text-lg font-bold text-gray-900">
					{previewDialog.type === 'ad_video' ? '广告视频预览' : '图片预览'}
				</h3>
				<button 
					type="button"
					aria-label="关闭预览对话框"
					onclick={closePreview}
					class="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M18 6 6 18"/><path d="m6 6 12 12"/>
					</svg>
				</button>
			</div>

			<!-- Content -->
			<div class="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
				{#if previewDialog.type === 'ad_video'}
					<div class="grid grid-cols-1 gap-4">
						{#each previewDialog.urls as url, i (url)}
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium text-gray-700">视频 {i + 1}</span>
									<a 
										href={url} 
										download 
										class="text-xs text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
											<polyline points="7 10 12 15 17 10"/>
											<line x1="12" x2="12" y1="15" y2="3"/>
										</svg>
										下载
									</a>
								</div>
								<div class="relative aspect-video bg-black rounded-lg overflow-hidden">
									<video 
										src={url} 
										controls 
										class="w-full h-full"
										preload="metadata"
										aria-label={`生成的视频 ${i + 1}`}
									>
										<track kind="captions" src="" label="无字幕" />
										您的浏览器不支持视频播放
									</video>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="grid grid-cols-2 gap-4">
						{#each previewDialog.urls as url, i (url)}
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium text-gray-700">图片 {i + 1}</span>
									<a 
										href={url} 
										download 
										class="text-xs text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
											<polyline points="7 10 12 15 17 10"/>
											<line x1="12" x2="12" y1="15" y2="3"/>
										</svg>
										下载
									</a>
								</div>
								<div class="relative aspect-square bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
									<img 
										src={url} 
										alt={`生成的图片 ${i + 1}`}
										class="w-full h-full object-cover"
									/>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
