// src/lib/server/jobs/handlers/adVideoWorkflow.ts
import type { Job } from 'pg-boss';
import type { AdVideoWorkflowJobData } from '../types';
import { getTaskById, updateTaskStatus } from '../../services/ugcTask';
import { executeAdVideoWorkflow } from '../../services/adVideoWorkflow';

/**
 * 处理广告视频工作流任务
 */
export async function handleAdVideoWorkflow(
	job: Job<AdVideoWorkflowJobData>
): Promise<void> {
	const { taskId } = job.data;

	console.log(`\n🎬 Starting ad video workflow job ${job.id} for task ${taskId}`);

	try {
		// 1. 获取任务
		const task = await getTaskById(taskId);

		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}

		// 验证任务类型
		if (task.taskType !== 'ad_video') {
			throw new Error(`Task ${taskId} is not an ad_video task (type: ${task.taskType})`);
		}

		// 2. 执行广告视频工作流
		const result = await executeAdVideoWorkflow(task);

		if (result.status === 'completed') {
			console.log(`✅ Ad video workflow completed for task ${taskId}`);
			console.log(`   Final video: ${result.finalVideoPath}`);
		} else {
			throw new Error(result.error || 'Unknown error during ad video workflow');
		}
	} catch (error) {
		console.error(`❌ Ad video workflow job ${job.id} failed:`, error);

		// 更新任务状态为失败
		await updateTaskStatus(
			taskId,
			'failed',
			error instanceof Error ? error.message : 'Unknown error'
		);

		throw error; // pg-boss 会处理重试
	}
}
