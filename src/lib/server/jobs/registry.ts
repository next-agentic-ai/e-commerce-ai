// src/lib/server/jobs/registry.ts
import { getPgBoss } from './pgBoss';
import { JOB_NAMES, ImageGenerationWorkflowJobSchema, AdVideoWorkflowJobSchema } from './types';
import { handleImageGenerationWorkflow } from './handlers/imageGenerationWorkflow.js';
import { handleAdVideoWorkflow } from './handlers/adVideoWorkflow.js';

/**
 * 注册所有任务处理器
 */
export async function registerJobHandlers(): Promise<void> {
	const boss = getPgBoss();

	// 先创建队列（如果不存在）
	console.log('📋 Creating queues...');
	await boss.createQueue(JOB_NAMES.IMAGE_GENERATION_WORKFLOW);
	await boss.createQueue(JOB_NAMES.AD_VIDEO_WORKFLOW);
	console.log('✅ Queues created');

	// 注册图片生成工作流任务
	await boss.work(
		JOB_NAMES.IMAGE_GENERATION_WORKFLOW,
		{
			batchSize: 1,
			pollingIntervalSeconds: 1
		},
		async (jobs) => {
			for (const job of jobs) {
				const data = ImageGenerationWorkflowJobSchema.parse(job.data);
				await handleImageGenerationWorkflow({ ...job, data });
			}
		}
	);

	console.log(`✅ Registered handler: ${JOB_NAMES.IMAGE_GENERATION_WORKFLOW}`);

	// 注册广告视频工作流任务
	await boss.work(
		JOB_NAMES.AD_VIDEO_WORKFLOW,
		{
			batchSize: 1,
			pollingIntervalSeconds: 1
		},
		async (jobs) => {
			for (const job of jobs) {
				const data = AdVideoWorkflowJobSchema.parse(job.data);
				await handleAdVideoWorkflow({ ...job, data });
			}
		}
	);

	console.log(`✅ Registered handler: ${JOB_NAMES.AD_VIDEO_WORKFLOW}`);
}

/**
 * 发送图片生成工作流任务
 */
export async function sendImageGenerationWorkflowJob(taskId: string) {
	const { getPgBoss, ensurePgBossStarted } = await import('./pgBoss.js');
	
	// 确保 pg-boss 已启动（Web 环境需要）
	await ensurePgBossStarted();
	
	const boss = getPgBoss();
	
	const jobId = await boss.send(
		JOB_NAMES.IMAGE_GENERATION_WORKFLOW,
		{ taskId },
		{
			retryLimit: 2,
			retryDelay: 60,
			retryBackoff: true,
			expireInSeconds: 3600 // 1小时后过期（图片生成较快）
		}
	);

	console.log(`📤 Sent image generation job ${jobId} for task ${taskId}`);
	return jobId;
}

/**
 * 发送广告视频工作流任务
 */
export async function sendAdVideoWorkflowJob(taskId: string) {
	const { getPgBoss, ensurePgBossStarted } = await import('./pgBoss.js');
	
	// 确保 pg-boss 已启动（Web 环境需要）
	await ensurePgBossStarted();
	
	const boss = getPgBoss();
	
	const jobId = await boss.send(
		JOB_NAMES.AD_VIDEO_WORKFLOW,
		{ taskId },
		{
			retryLimit: 1, // 广告视频工作流较长，只重试1次
			retryDelay: 120, // 2分钟后重试
			retryBackoff: true,
			expireInSeconds: 14400 // 4小时后过期（广告视频工作流较长）
		}
	);

	console.log(`📤 Sent ad video workflow job ${jobId} for task ${taskId}`);
	return jobId;
}
