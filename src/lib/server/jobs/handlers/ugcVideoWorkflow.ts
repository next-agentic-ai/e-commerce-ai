// src/lib/server/jobs/handlers/ugcVideoWorkflow.ts
import { getTaskById, updateTaskStatus } from '../../services/ugcTask.js';
import { executeUgcVideoWorkflow } from '../../services/ugcWorkflow.js';
import { getPgBoss } from '../pgBoss.js';
import { JOB_NAMES, type UgcVideoWorkflowJobData } from '../types.js';
import type { Job } from 'pg-boss';

/**
 * UGC视频工作流任务处理器
 */
export async function handleUgcVideoWorkflow(
	job: Job<UgcVideoWorkflowJobData>
): Promise<void> {
	const { taskId, generateAudio } = job.data;

	console.log(`[Job ${job.id}] Starting UGC video workflow for task ${taskId}`);

	try {
		// 1. 获取任务
		const task = await getTaskById(taskId);

		if (!task) {
			throw new Error(`Task not found: ${taskId}`);
		}

		// 2. 更新任务状态为 analyzing
		await updateTaskStatus(taskId, 'analyzing');

		// 3. 执行工作流
		const result = await executeUgcVideoWorkflow(task, generateAudio);

		if (result.status === 'failed') {
			throw new Error(result.error || 'Workflow failed');
		}

		// 4. 工作流执行成功，创建轮询任务
		if (result.videoClipIds && result.videoClipIds.length > 0) {
			const boss = getPgBoss();
			await boss.send(
				JOB_NAMES.POLL_VIDEO_STATUS,
				{
					videoClipIds: result.videoClipIds,
					taskId,
					maxAttempts: 60,
					pollInterval: 10000
				},
				{
					retryLimit: 2,
					retryDelay: 30
				}
			);

			console.log(`[Job ${job.id}] Created poll job for ${result.videoClipIds.length} video clips`);
		}

		console.log(`[Job ${job.id}] UGC video workflow completed:`, {
			productId: result.productId,
			scriptId: result.scriptId,
			shotIds: result.shotIds,
			videoClipIds: result.videoClipIds
		});

	} catch (error) {
		console.error(`[Job ${job.id}] UGC video workflow failed:`, error);

		// 更新任务状态为 failed
		await updateTaskStatus(
			taskId,
			'failed',
			error instanceof Error ? error.message : 'Unknown error'
		);

		throw error; // 重新抛出让 pg-boss 处理重试
	}
}
