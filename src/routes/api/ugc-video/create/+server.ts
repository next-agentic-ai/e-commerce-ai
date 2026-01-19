// src/routes/api/ugc-video/create/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { createUgcTask } from '$lib/server/services/ugcTask';

/**
 * POST /api/ugc-video/create
 * 创建 UGC 视频任务
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const body = await request.json();
		const { productImageIds, targetDuration, aspectRatio, language, videoCount, generateAudio } = body;

		// 验证必需参数
		if (!productImageIds || !Array.isArray(productImageIds) || productImageIds.length === 0) {
			return json(
				{ error: 'productImageIds is required and must be a non-empty array' },
				{ status: 400 }
			);
		}

		// 假设有用户认证
		const userId = locals.user?.id || 'demo-user';

		// 使用任务服务创建任务
		const { task, jobId } = await createUgcTask({
			userId,
			productImageIds,
			targetDuration: targetDuration || 12,
			aspectRatio: aspectRatio || '9:16',
			language: language || 'zh',
			videoCount: videoCount || 1
		});

		// 返回任务信息
		return json({
			success: true,
			taskId: task.id,
			jobId,
			status: 'pending',
			message: 'Video generation task created and queued'
		});

	} catch (error) {
		console.error('Failed to create UGC video task:', error);
		return json(
			{
				error: 'Failed to create task',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
