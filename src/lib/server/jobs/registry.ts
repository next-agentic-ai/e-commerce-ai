// src/lib/server/jobs/registry.ts
import { getPgBoss } from './pgBoss';
import { JOB_NAMES, UgcVideoWorkflowJobSchema, PollVideoStatusJobSchema, ImageGenerationWorkflowJobSchema } from './types';
import { handleUgcVideoWorkflow } from './handlers/ugcVideoWorkflow';
import { handlePollVideoStatus } from './handlers/pollVideoStatus';
import { handleImageGenerationWorkflow } from './handlers/imageGenerationWorkflow.js';

/**
 * 注册所有任务处理器
 */
export async function registerJobHandlers(): Promise<void> {
	const boss = getPgBoss();

	// 先创建队列（如果不存在）
	console.log('📋 Creating queues...');
	await boss.createQueue(JOB_NAMES.UGC_VIDEO_WORKFLOW);
	await boss.createQueue(JOB_NAMES.POLL_VIDEO_STATUS);
	await boss.createQueue(JOB_NAMES.IMAGE_GENERATION_WORKFLOW);
	console.log('✅ Queues created');

	// 注册 UGC 视频工作流任务
	await boss.work(
		JOB_NAMES.UGC_VIDEO_WORKFLOW,
		{
			batchSize: 1, // 一次处理1个任务
			pollingIntervalSeconds: 1 // 每秒检查一次新任务
		},
		async (jobs) => {
			// pg-boss v12 传递的是 job 数组
			for (const job of jobs) {
				// 验证数据
				const data = UgcVideoWorkflowJobSchema.parse(job.data);
				await handleUgcVideoWorkflow({ ...job, data });
			}
		}
	);

	console.log(`✅ Registered handler: ${JOB_NAMES.UGC_VIDEO_WORKFLOW}`);

	// 注册轮询视频状态任务
	await boss.work(
		JOB_NAMES.POLL_VIDEO_STATUS,
		{
			batchSize: 1, // 一次处理1个任务
			pollingIntervalSeconds: 1
		},
		async (jobs) => {
			// pg-boss v12 传递的是 job 数组
			for (const job of jobs) {
				// 验证数据
				const data = PollVideoStatusJobSchema.parse(job.data);
				await handlePollVideoStatus({ ...job, data });
			}
		}
	);

	console.log(`✅ Registered handler: ${JOB_NAMES.POLL_VIDEO_STATUS}`);

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
}

/**
 * 发送 UGC 视频工作流任务
 */
export async function sendUgcVideoWorkflowJob(taskId: string, generateAudio: boolean = true) {
	const { getPgBoss, ensurePgBossStarted } = await import('./pgBoss.js');
	
	// 确保 pg-boss 已启动（Web 环境需要）
	await ensurePgBossStarted();
	
	const boss = getPgBoss();
	
	const jobId = await boss.send(
		JOB_NAMES.UGC_VIDEO_WORKFLOW,
		{
			taskId,
			generateAudio
		},
		{
			retryLimit: 2, // 失败后重试2次
			retryDelay: 60, // 60秒后重试
			retryBackoff: true, // 指数退避
			expireInSeconds: 7200 // 2小时后过期
		}
	);

	console.log(`📤 Sent job ${jobId} for task ${taskId}`);
	return jobId;
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
