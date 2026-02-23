// src/lib/server/services/ugcTask.ts
/**
 * 内容生成任务管理服务
 * 负责任务的创建、查询、更新等操作（支持图片和广告视频生成）
 */

import { db } from '../db';
import { generationTask, promotionalImage, adFinalVideo } from '../db/schema';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { sendImageGenerationWorkflowJob, sendAdVideoWorkflowJob } from '../jobs/index';
import type { GenerationTask } from '../db/schema';

/**
 * 创建图片任务参数
 */
export interface CreateImageTaskParams {
	userId: string;
	productImageId: string; // 只支持一张产品图片
	aspectRatio: '1:1'; // 目前只支持 1:1
	language: 'zh' | 'en' | 'es' | 'hi' | 'ar' | 'pt' | 'ru' | 'ja';
	imageCount?: number;
}

/**
 * 创建广告视频任务参数
 */
export interface CreateAdVideoTaskParams {
	userId: string;
	productImageId: string; // 只支持一张产品图片
	aspectRatio: '9:16' | '16:9';
}

/**
 * 任务详情（包含关联的图片或广告视频）
 */
export interface TaskDetail extends GenerationTask {
	images?: Array<{
		id: string;
		downloadStatus: string;
		sourceImageUrl: string | null;
		path: string | null;
		width: number | null;
		height: number | null;
	}>;
	adFinalVideos?: Array<{
		id: string;
		path: string;
		duration: number;
		width: number;
		height: number;
	}>;
}

/**
 * 创建图片生成任务
 */
export async function createImageTask(params: CreateImageTaskParams): Promise<{
	task: GenerationTask;
	jobId: string | null;
}> {
	const {
		userId,
		productImageId,
		aspectRatio,
		language,
		imageCount = 1
	} = params;

	// 1. 创建任务记录
	const [task] = await db
		.insert(generationTask)
		.values({
			userId,
			taskType: 'image',
			productImageId,
			aspectRatio,
			language,
			count: imageCount,
			status: 'pending'
		})
		.returning();

	console.log(`✅ Created image task ${task.id}`);

	// 2. 发送到图片生成任务队列
	const jobId = await sendImageGenerationWorkflowJob(task.id);

	// 3. 更新任务的 jobId
	await db
		.update(generationTask)
		.set({ jobId })
		.where(eq(generationTask.id, task.id));

	console.log(`📤 Sent job ${jobId} for task ${task.id}`);

	return { 
		task: { ...task, jobId }, 
		jobId 
	};
}

/**
 * 创建广告视频生成任务
 */
export async function createAdVideoTask(params: CreateAdVideoTaskParams): Promise<{
	task: GenerationTask;
	jobId: string | null;
}> {
	const {
		userId,
		productImageId,
		aspectRatio
	} = params;

	// 1. 创建任务记录
	const [task] = await db
		.insert(generationTask)
		.values({
			userId,
			taskType: 'ad_video',
			productImageId,
			aspectRatio,
			language: 'zh', // 广告视频默认中文
			count: 1,
			status: 'pending'
		})
		.returning();

	console.log(`✅ Created ad video task ${task.id}`);

	// 2. 发送到广告视频任务队列
	const jobId = await sendAdVideoWorkflowJob(task.id);

	// 3. 更新任务的 jobId
	await db
		.update(generationTask)
		.set({ jobId })
		.where(eq(generationTask.id, task.id));

	console.log(`📤 Sent ad video job ${jobId} for task ${task.id}`);

	return {
		task: { ...task, jobId },
		jobId
	};
}

/**
 * 获取用户的任务列表
 */
export async function getUserTasks(
	userId: string,
	limit: number = 50,
	taskType?: 'image' | 'ad_video'
): Promise<TaskDetail[]> {
	const whereConditions = taskType 
		? and(eq(generationTask.userId, userId), eq(generationTask.taskType, taskType))
		: eq(generationTask.userId, userId);

	const tasks = await db.query.generationTask.findMany({
		where: whereConditions,
		orderBy: [desc(generationTask.createdAt)],
		limit
	});

	if (tasks.length === 0) {
		return [];
	}

	// 批量获取关联数据
	const imageTaskIds = tasks.filter(t => t.taskType === 'image').map(t => t.id);
	const adVideoTaskIds = tasks.filter(t => t.taskType === 'ad_video').map(t => t.id);

	let allPromotionalImages: any[] = [];
	let allAdFinalVideos: any[] = [];

	if (imageTaskIds.length > 0) {
		allPromotionalImages = await db.query.promotionalImage.findMany({
			where: inArray(promotionalImage.taskId, imageTaskIds)
		});
	}

	if (adVideoTaskIds.length > 0) {
		allAdFinalVideos = await db.query.adFinalVideo.findMany({
			where: inArray(adFinalVideo.taskId, adVideoTaskIds)
		});
	}

	// 组装数据
	return tasks.map(task => {
		const result: TaskDetail = { ...task };

		if (task.taskType === 'image') {
			const images = allPromotionalImages.filter(img => img.taskId === task.id);
			result.images = images.map(img => ({
				id: img.id,
				downloadStatus: 'completed',
				sourceImageUrl: null,
				path: img.path,
				width: img.width,
				height: img.height
			}));
		} else if (task.taskType === 'ad_video') {
			const finalVideos = allAdFinalVideos.filter(v => v.taskId === task.id);
			result.adFinalVideos = finalVideos.map(v => ({
				id: v.id,
				path: v.path,
				duration: v.duration,
				width: v.width,
				height: v.height
			}));
		}

		return result;
	});
}

/**
 * 根据ID获取任务
 */
export async function getTaskById(taskId: string): Promise<GenerationTask | null> {
	const task = await db.query.generationTask.findFirst({
		where: eq(generationTask.id, taskId)
	});

	return task || null;
}

/**
 * 获取任务详情（包含图片或广告视频）
 */
export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
	const task = await db.query.generationTask.findFirst({
		where: eq(generationTask.id, taskId)
	});

	if (!task) {
		return null;
	}

	const result: TaskDetail = { ...task };

	if (task.taskType === 'image') {
		const images = await db.query.promotionalImage.findMany({
			where: eq(promotionalImage.taskId, taskId)
		});

		result.images = images.map(img => ({
			id: img.id,
			downloadStatus: 'completed',
			sourceImageUrl: null,
			path: img.path,
			width: img.width,
			height: img.height
		}));
	} else if (task.taskType === 'ad_video') {
		const finalVideos = await db.query.adFinalVideo.findMany({
			where: eq(adFinalVideo.taskId, taskId)
		});

		result.adFinalVideos = finalVideos.map(v => ({
			id: v.id,
			path: v.path,
			duration: v.duration,
			width: v.width,
			height: v.height
		}));
	}

	return result;
}

/**
 * 更新任务状态
 */
export async function updateTaskStatus(
	taskId: string,
	status: 'pending' | 'analyzing' | 'scripting' | 'storyboarding' | 'generating_frames' | 'generating_images' | 'generating_videos' | 'compositing' | 'completed' | 'failed' | 'cancelled',
	errorMessage?: string | null
): Promise<void> {
	const updateData: any = { status };

	const processingStatuses = ['analyzing', 'scripting', 'storyboarding', 'generating_frames', 'generating_images', 'generating_videos', 'compositing'];
	if (processingStatuses.includes(status) && !errorMessage) {
		updateData.startedAt = new Date();
	}

	if (status === 'completed' || status === 'failed' || status === 'cancelled') {
		updateData.completedAt = new Date();
	}

	if (errorMessage !== undefined) {
		updateData.errorMessage = errorMessage;
	}

	await db
		.update(generationTask)
		.set(updateData)
		.where(eq(generationTask.id, taskId));
}

/**
 * 删除任务（硬删除）
 */
export async function deleteTask(taskId: string, userId: string): Promise<boolean> {
	const task = await db.query.generationTask.findFirst({
		where: and(
			eq(generationTask.id, taskId),
			eq(generationTask.userId, userId)
		)
	});

	if (!task) {
		return false;
	}

	await db.delete(generationTask).where(eq(generationTask.id, taskId));

	return true;
}

/**
 * 获取任务统计信息
 */
export async function getTaskStats(userId: string, taskType?: 'image' | 'ad_video'): Promise<{
	total: number;
	pending: number;
	processing: number;
	completed: number;
	failed: number;
	cancelled: number;
}> {
	const whereConditions = taskType 
		? and(eq(generationTask.userId, userId), eq(generationTask.taskType, taskType))
		: eq(generationTask.userId, userId);

	const tasks = await db.query.generationTask.findMany({
		where: whereConditions
	});

	const processingStatuses = ['analyzing', 'scripting', 'storyboarding', 'generating_frames', 'generating_images', 'generating_videos', 'compositing'];

	return {
		total: tasks.length,
		pending: tasks.filter(t => t.status === 'pending').length,
		processing: tasks.filter(t => processingStatuses.includes(t.status)).length,
		completed: tasks.filter(t => t.status === 'completed').length,
		failed: tasks.filter(t => t.status === 'failed').length,
		cancelled: tasks.filter(t => t.status === 'cancelled').length
	};
}

/**
 * 重试失败的任务
 */
export async function retryTask(taskId: string, userId: string): Promise<{
	task: GenerationTask;
	jobId: string | null;
} | null> {
	const task = await db.query.generationTask.findFirst({
		where: and(
			eq(generationTask.id, taskId),
			eq(generationTask.userId, userId)
		)
	});

	if (!task || task.status !== 'failed') {
		return null;
	}

	// 重置任务状态
	await db
		.update(generationTask)
		.set({
			status: 'pending',
			errorMessage: null,
			startedAt: null,
			completedAt: null
		})
		.where(eq(generationTask.id, taskId));

	// 根据任务类型重新发送到任务队列
	let jobId: string | null = null;
	
	if (task.taskType === 'image') {
		jobId = await sendImageGenerationWorkflowJob(taskId);
	} else if (task.taskType === 'ad_video') {
		jobId = await sendAdVideoWorkflowJob(taskId);
	}

	const updatedTask = await getTaskById(taskId);

	if (!updatedTask) {
		return null;
	}

	return { task: updatedTask, jobId };
}
