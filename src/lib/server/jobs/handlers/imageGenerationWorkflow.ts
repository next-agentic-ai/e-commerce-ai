// src/lib/server/jobs/handlers/imageGenerationWorkflow.ts
import type { Job } from 'pg-boss';
import type { ImageGenerationWorkflowJobData } from '../types';
import { getTaskById } from '../../services/ugcTask';
import { executeImageGenerationWorkflow } from '../../services/imageWorkflow';

/**
 * 处理图片生成工作流任务
 */
export async function handleImageGenerationWorkflow(
	job: Job<ImageGenerationWorkflowJobData>
): Promise<void> {
	const { taskId } = job.data;

	console.log(`\n🎨 Starting image generation workflow job ${job.id} for task ${taskId}`);

	try {
		// 1. 获取任务
		const task = await getTaskById(taskId);

		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}

		// 验证任务类型
		if (task.taskType !== 'image') {
			throw new Error(`Task ${taskId} is not an image generation task`);
		}

		// 2. 执行图片生成工作流
		const result = await executeImageGenerationWorkflow(task);

		if (result.status === 'completed') {
			console.log(`✅ Image generation workflow completed for task ${taskId}`);
			console.log(`   Generated ${result.generatedCount} images`);
		} else {
			throw new Error(result.error || 'Unknown error during image generation');
		}
	} catch (error) {
		console.error(`❌ Image generation workflow job ${job.id} failed:`, error);
		throw error; // pg-boss 会处理重试
	}
}
