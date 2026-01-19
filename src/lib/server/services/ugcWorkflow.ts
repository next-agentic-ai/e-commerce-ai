// src/lib/server/services/ugcWorkflow.ts
/**
 * UGC视频生成完整工作流
 * 整合产品分析 -> 脚本生成 -> 分镜生成 -> 视频生成
 */

import type { GenerationTask } from '../db/schema.js';
import { analyzeAndCreateProduct } from './productAnalysis.js';
import { generateAndSaveUgcScripts } from './ugcScript.js';
import { generateAndSaveShotBreakdowns } from './shotBreakdown.js';
import { 
	batchCreateVideoTasks, 
	batchUpdateVideoStatus
} from './videoGeneration.js';

/**
 * 工作流状态
 */
export type WorkflowStatus = 
	| 'pending'
	| 'analyzing'
	| 'scripting'
	| 'storyboarding'
	| 'generating_videos'
	| 'completed'
	| 'failed';

/**
 * 工作流结果
 */
export interface WorkflowResult {
	status: WorkflowStatus;
	productId?: string;
	scriptId?: string;
	shotIds?: string[];
	videoClipIds?: string[];
	completedVideos?: number;
	error?: string;
}

/**
 * 完整的UGC视频生成工作流
 * 
 * @param task - 生成任务
 * @param generateAudio - 是否生成音频（默认true）
 * @returns 工作流结果
 */
export async function executeUgcVideoWorkflow(
	task: GenerationTask,
	generateAudio: boolean = true
): Promise<WorkflowResult> {
	try {
		// 验证视频生成任务必须有 targetDuration
		if (!task.targetDuration) {
			throw new Error('Target duration is required for video generation workflow');
		}

		// 1. 分析产品
		console.log('Step 1: Analyzing product...');
		const { product } = await analyzeAndCreateProduct(task);
		console.log(`Product analyzed: ${product.name}`);

		// 2. 生成脚本
		console.log('Step 2: Generating UGC script...');
		const scriptResult = await generateAndSaveUgcScripts(task, product);
		
		if (scriptResult.scripts.length === 0) {
			throw new Error('Failed to generate scripts');
		}

		const script = scriptResult.scripts[0]; // 使用第一个脚本
		console.log(`Script generated: ${script.title}`);

		// 3. 生成分镜
		console.log('Step 3: Generating shot breakdowns...');
		const shotResult = await generateAndSaveShotBreakdowns(
			script,
			product,
			task.targetDuration  // TypeScript 现在知道这不是 null
		);

		console.log(`Generated ${shotResult.count} shots, total duration: ${shotResult.totalDuration}s`);

		// 4. 为所有分镜创建一个视频生成任务（合并所有分镜，字节支持最长12秒）
		console.log('Step 4: Creating video generation task...');
		const videoTask = await batchCreateVideoTasks(
			shotResult.shots,
			task,     // 传入task对象（包含aspectRatio）
			script,   // 传入script对象
			generateAudio
		);

		console.log(`Created video generation task: ${videoTask.videoClipId}`);

		return {
			status: 'generating_videos',
			productId: product.id,
			scriptId: script.id,
			shotIds: shotResult.shots.map(shot => shot.id),
			videoClipIds: [videoTask.videoClipId]  // 现在只有一个视频任务
		};

	} catch (error) {
		console.error('Workflow failed:', error);
		return {
			status: 'failed',
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

/**
 * 轮询检查视频生成状态
 * 
 * @param videoClipIds - 视频片段ID列表
 * @param maxAttempts - 最大轮询次数（默认60次）
 * @param pollInterval - 轮询间隔（毫秒，默认10秒）
 * @returns 完成的视频数量
 */
export async function pollVideoGenerationStatus(
	videoClipIds: string[],
	maxAttempts: number = 60,
	pollInterval: number = 10000
): Promise<{
	completed: number;
	failed: number;
	pending: number;
	videoUrls: string[];
}> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// 等待一段时间再查询
		await new Promise(resolve => setTimeout(resolve, pollInterval));

		// 批量查询状态
		const statuses = await batchUpdateVideoStatus(videoClipIds);

		const completed = statuses.filter(s => s.status === 'succeeded').length;
		const failed = statuses.filter(s => s.status === 'failed').length;
		const pending = statuses.length - completed - failed;

		console.log(`Attempt ${attempt + 1}/${maxAttempts}: Completed ${completed}, Failed ${failed}, Pending ${pending}`);

		// 如果全部完成
		if (pending === 0) {
			const videoUrls = statuses
				.filter(s => s.status === 'succeeded' && s.videoUrl)
				.map(s => s.videoUrl!);

			return {
				completed,
				failed,
				pending,
				videoUrls
			};
		}
	}

	// 超时返回当前状态
	const statuses = await batchUpdateVideoStatus(videoClipIds);
	const completed = statuses.filter(s => s.status === 'succeeded').length;
	const failed = statuses.filter(s => s.status === 'failed').length;
	const videoUrls = statuses
		.filter(s => s.status === 'succeeded' && s.videoUrl)
		.map(s => s.videoUrl!);

	return {
		completed,
		failed,
		pending: statuses.length - completed - failed,
		videoUrls
	};
}

/**
 * 完整工作流 + 等待视频生成完成
 * 
 * @param task - 生成任务
 * @param generateAudio - 是否生成音频（默认true）
 * @param waitForCompletion - 是否等待视频生成完成（默认true）
 * @returns 工作流结果
 */
export async function executeCompleteWorkflow(
	task: GenerationTask,
	generateAudio: boolean = true,
	waitForCompletion: boolean = true
): Promise<WorkflowResult> {
	// 执行工作流
	const result = await executeUgcVideoWorkflow(task, generateAudio);

	if (result.status !== 'generating_videos' || !result.videoClipIds) {
		return result;
	}

	if (!waitForCompletion) {
		return result;
	}

	// 等待视频生成完成
	console.log('Waiting for video generation to complete...');
	const pollResult = await pollVideoGenerationStatus(result.videoClipIds);

	if (pollResult.pending === 0 && pollResult.failed === 0) {
		return {
			...result,
			status: 'completed',
			completedVideos: pollResult.completed
		};
	} else if (pollResult.completed > 0 && pollResult.failed > 0) {
		return {
			...result,
			status: 'completed',
			completedVideos: pollResult.completed,
			error: `${pollResult.failed} videos failed to generate`
		};
	} else {
		return {
			...result,
			status: 'failed',
			error: 'All videos failed to generate or timed out'
		};
	}
}
