// src/routes/api/ugc-video/status/[taskId]/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { getTaskDetail } from '$lib/server/services/ugcTask';

/**
 * GET /api/ugc-video/status/:taskId
 * 查询 UGC 视频任务状态
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const { taskId } = params;

		if (!taskId) {
			return json({ error: 'taskId is required' }, { status: 400 });
		}

		// 使用任务服务获取详情
		const taskDetail = await getTaskDetail(taskId);

		if (!taskDetail) {
			return json({ error: 'Task not found' }, { status: 404 });
		}

		return json({
			task: {
				id: taskDetail.id,
				status: taskDetail.status,
				targetDuration: taskDetail.targetDuration,
				aspectRatio: taskDetail.aspectRatio,
				errorMessage: taskDetail.errorMessage,
				createdAt: taskDetail.createdAt,
				startedAt: taskDetail.startedAt,
				completedAt: taskDetail.completedAt
			},
			videos: taskDetail.videos || []
		});

	} catch (error) {
		console.error('Failed to get task status:', error);
		return json(
			{
				error: 'Failed to get status',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
