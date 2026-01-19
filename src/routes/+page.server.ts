// src/routes/+page.server.ts
import { fail } from '@sveltejs/kit';
import { getUserProductImages, deleteProductImage, uploadProductImages } from '$lib/server/services/productImage';
import { createUgcTask, createImageTask, getUserTasks } from '$lib/server/services/ugcTask';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	// 获取父级 layout 数据
	const layoutData = await parent();
	
	// 如果用户已登录，加载其产品图片和任务列表
	if (locals.user) {
		const images = await getUserProductImages(locals.user.id);
		const tasks = await getUserTasks(locals.user.id, 50);

		return {
			...layoutData,
			images,
			tasks
		};
	}

	return {
		...layoutData,
		images: [],
		tasks: []
	};
};

export const actions = {
	upload: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { error: 'Unauthorized' });
		}

		const formData = await request.formData();
		const files = formData.getAll('images') as File[];
		const imageMetadata = formData.get('imageMetadata') as string;

		if (!files || files.length === 0) {
			return fail(400, { error: '请至少上传一张图片' });
		}

		// 验证文件数量（最多9张）
		if (files.length > 9) {
			return fail(400, { error: '最多只能上传9张图片' });
		}

		// 验证文件大小（每个文件最大5MB）
		const maxSize = 5 * 1024 * 1024; // 5MB
		for (const file of files) {
			if (file.size > maxSize) {
				return fail(400, { error: `文件 ${file.name} 超过5MB限制` });
			}
		}

		try {
			// 解析图片元数据（宽高信息）
			let metadata: Array<{ width?: number; height?: number }> = [];
			if (imageMetadata) {
				try {
					metadata = JSON.parse(imageMetadata);
				} catch (e) {
					console.warn('Failed to parse image metadata:', e);
				}
			}

			// 准备文件数据
			const filesWithMetadata = files.map((file, index) => ({
				file,
				width: metadata[index]?.width,
				height: metadata[index]?.height
			}));

			// 上传图片
			const uploadedImages = await uploadProductImages(locals.user.id, filesWithMetadata);
			
			// 为每个图片添加 URL
			const imagesWithUrl = uploadedImages.map((img) => ({
				id: img.id,
				name: img.name,
				path: img.path,
				url: `/storage/${img.path}`,
				width: img.width,
				height: img.height,
				fileSize: img.fileSize,
				createdAt: img.createdAt
			}));

			return {
				success: true,
				images: imagesWithUrl
			};
		} catch (error) {
			console.error('Upload error:', error);
			return fail(500, { error: '上传失败，请重试' });
		}
	},
	
	delete: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { error: 'Unauthorized' });
		}

		const formData = await request.formData();
		const imageId = formData.get('imageId') as string;

		try {
			await deleteProductImage(imageId, locals.user.id);
			return { success: true };
		} catch (error) {
			console.error('Delete error:', error);
			return fail(500, { error: '删除失败' });
		}
	},

	generate: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { error: 'Unauthorized' });
		}

		const formData = await request.formData();
		const imageIdsJson = formData.get('imageIds') as string;
		const targetDuration = parseInt(formData.get('targetDuration') as string || '12');
		const aspectRatio = (formData.get('aspectRatio') as string) || '9:16';
		const language = (formData.get('language') as string) || 'zh';
		const videoCount = parseInt(formData.get('videoCount') as string || '1');
		const referenceVideoUrl = formData.get('referenceVideoUrl') as string | null;

		// 验证产品图片
		if (!imageIdsJson) {
			return fail(400, { error: '请选择产品图片' });
		}

		try {
			const imageIds = JSON.parse(imageIdsJson) as string[];
			
			// 验证图片数量
			if (imageIds.length === 0) {
				return fail(400, { error: '请至少选择一张图片' });
			}

			if (imageIds.length > 9) {
				return fail(400, { error: '最多只能选择9张产品图片' });
			}

			// 验证视频尺寸
			if (!['9:16', '16:9', '1:1', '4:5'].includes(aspectRatio)) {
				return fail(400, { error: '无效的视频尺寸' });
			}

			// 验证视频时长
			if (![12, 24].includes(targetDuration)) {
				return fail(400, { error: '视频时长只能是12秒或24秒' });
			}

			// 验证语言
			if (!['zh', 'en', 'es', 'hi', 'ar', 'pt', 'ru', 'ja'].includes(language)) {
				return fail(400, { error: '不支持的语言' });
			}

			// 验证视频数量
			if (videoCount < 1 || videoCount > 10) {
				return fail(400, { error: '视频数量必须在1-10之间' });
			}

			// 使用任务服务创建任务
			const { task, jobId } = await createUgcTask({
				userId: locals.user.id,
				productImageIds: imageIds,
				targetDuration,
				aspectRatio: aspectRatio as '9:16' | '16:9' | '1:1' | '4:5',
				language: language as 'zh' | 'en' | 'es' | 'hi' | 'ar' | 'pt' | 'ru' | 'ja',
				videoCount,
				referenceVideoUrl
			});

			return {
				success: true,
				taskId: task.id,
				jobId,
				message: '视频生成任务已创建，正在后台处理'
			};
		} catch (error) {
			console.error('Generate error:', error);
			const errorMessage = error instanceof Error ? error.message : '创建任务失败，请重试';
			return fail(500, { error: errorMessage });
		}
	},

	generateImage: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { error: 'Unauthorized' });
		}

		const formData = await request.formData();
		const imageIdsJson = formData.get('imageIds') as string;
		const aspectRatio = (formData.get('aspectRatio') as string) || '1:1';
		const language = (formData.get('language') as string) || 'zh';
		const imageCount = parseInt(formData.get('imageCount') as string || '1');

		// 验证产品图片
		if (!imageIdsJson) {
			return fail(400, { error: '请选择产品图片' });
		}

		try {
			const imageIds = JSON.parse(imageIdsJson) as string[];
			
			// 验证图片数量
			if (imageIds.length === 0) {
				return fail(400, { error: '请至少选择一张图片' });
			}

			if (imageIds.length > 9) {
				return fail(400, { error: '最多只能选择9张产品图片' });
			}

			// 验证尺寸（目前只支持1:1）
			if (aspectRatio !== '1:1') {
				return fail(400, { error: '目前只支持1:1尺寸' });
			}

			// 验证语言
			if (!['zh', 'en', 'es', 'hi', 'ar', 'pt', 'ru', 'ja'].includes(language)) {
				return fail(400, { error: '不支持的语言' });
			}

			// 验证图片数量
			if (imageCount < 1 || imageCount > 10) {
				return fail(400, { error: '图片数量必须在1-10之间' });
			}

			// 使用任务服务创建图片生成任务
			const { task, jobId } = await createImageTask({
				userId: locals.user.id,
				productImageIds: imageIds,
				aspectRatio: aspectRatio as '1:1',
				language: language as 'zh' | 'en' | 'es' | 'hi' | 'ar' | 'pt' | 'ru' | 'ja',
				imageCount
			});

			return {
				success: true,
				taskId: task.id,
				jobId,
				message: '宣传图生成任务已创建，正在后台处理'
			};
		} catch (error) {
			console.error('Generate image error:', error);
			const errorMessage = error instanceof Error ? error.message : '创建任务失败，请重试';
			return fail(500, { error: errorMessage });
		}
	}
} satisfies Actions;
