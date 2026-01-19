// src/lib/server/services/ugcTask.ts
/**
 * 内容生成任务管理服务
 * 负责任务的创建、查询、更新等操作（支持视频和图片生成）
 */

import { db } from '../db/index.js';
import { generationTask, videoClip, promotionalImage } from '../db/schema.js';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { sendUgcVideoWorkflowJob, sendImageGenerationWorkflowJob } from '../jobs/index.js';
import type { GenerationTask } from '../db/schema.js';

/**
 * 创建视频任务参数
 */
export interface CreateVideoTaskParams {
	userId: string;
	productImageIds: string[];
	targetDuration: number;
	aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
	language: 'zh' | 'en' | 'es' | 'hi' | 'ar' | 'pt' | 'ru' | 'ja';
	videoCount?: number;
	referenceVideoUrl?: string | null;
}

/**
 * 创建图片任务参数
 */
export interface CreateImageTaskParams {
	userId: string;
	productImageIds: string[];
	aspectRatio: '1:1'; // 目前只支持 1:1
	language: 'zh' | 'en' | 'es' | 'hi' | 'ar' | 'pt' | 'ru' | 'ja';
	imageCount?: number;
}

/**
 * 统一创建任务参数
 */
export interface CreateTaskParams extends CreateVideoTaskParams {}

/**
 * 任务详情（包含关联的视频片段或图片）
 */
export interface TaskDetail extends GenerationTask {
	videos?: Array<{
		id: string;
		downloadStatus: string;
		sourceVideoUrl: string | null;
		duration: number | null;
		width: number | null;
		height: number | null;
	}>;
	images?: Array<{
		id: string;
		downloadStatus: string;
		sourceImageUrl: string | null;
		path: string | null;
		width: number | null;
		height: number | null;
	}>;
}

/**
 * 创建视频生成任务（统一入口）
 */
export async function createUgcTask(params: CreateTaskParams): Promise<{
	task: GenerationTask;
	jobId: string | null;
}> {
	return createVideoTask(params);
}

/**
 * 创建视频生成任务
 */
export async function createVideoTask(params: CreateVideoTaskParams): Promise<{
	task: GenerationTask;
	jobId: string | null;
}> {
	const {
		userId,
		productImageIds,
		targetDuration,
		aspectRatio,
		language,
		videoCount = 1,
		referenceVideoUrl = null
	} = params;

	// 1. 创建任务记录
	const [task] = await db
		.insert(generationTask)
		.values({
			userId,
			taskType: 'video',
			productImageIds,
			generationMode: referenceVideoUrl ? 'from_reference' : 'from_scratch',
			referenceVideoUrl,
			targetDuration,
			aspectRatio,
			language,
			count: videoCount,
			status: 'pending'
		})
		.returning();

	console.log(`✅ Created video task ${task.id}`);

	// 2. 发送到任务队列
	const jobId = await sendUgcVideoWorkflowJob(task.id, true);

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
 * 创建图片生成任务
 */
export async function createImageTask(params: CreateImageTaskParams): Promise<{
	task: GenerationTask;
	jobId: string | null;
}> {
	const {
		userId,
		productImageIds,
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
			productImageIds,
			generationMode: 'from_scratch',
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
 * 获取用户的任务列表
 */
export async function getUserTasks(
	userId: string,
	limit: number = 50,
	taskType?: 'video' | 'image'
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
	const videoTaskIds = tasks.filter(t => t.taskType === 'video').map(t => t.id);
	const imageTaskIds = tasks.filter(t => t.taskType === 'image').map(t => t.id);

	let allVideoClips: any[] = [];
	let allPromotionalImages: any[] = [];

	if (videoTaskIds.length > 0) {
		allVideoClips = await db.query.videoClip.findMany({
			where: inArray(videoClip.taskId, videoTaskIds)
		});
	}

	if (imageTaskIds.length > 0) {
		allPromotionalImages = await db.query.promotionalImage.findMany({
			where: inArray(promotionalImage.taskId, imageTaskIds)
		});
	}

	// 组装数据
	return tasks.map(task => {
		const result: TaskDetail = { ...task };

		if (task.taskType === 'video') {
			const clips = allVideoClips.filter(c => c.taskId === task.id);
			result.videos = clips.map(clip => ({
				id: clip.id,
				downloadStatus: clip.downloadStatus ?? 'pending',
				sourceVideoUrl: clip.sourceVideoUrl,
				duration: clip.duration ?? null,
				width: clip.width,
				height: clip.height
			}));
		} else if (task.taskType === 'image') {
			const images = allPromotionalImages.filter(img => img.taskId === task.id);
			result.images = images.map(img => ({
				id: img.id,
				downloadStatus: 'completed',
				sourceImageUrl: null,
				path: img.path,
				width: img.width,
				height: img.height
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
 * 获取任务详情（包含视频片段或图片）
 */
export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
	const task = await db.query.generationTask.findFirst({
		where: eq(generationTask.id, taskId)
	});

	if (!task) {
		return null;
	}

	const result: TaskDetail = { ...task };

	// 根据任务类型加载对应的资源
	if (task.taskType === 'video') {
		// 查询关联的视频片段
		const clips = await db.query.videoClip.findMany({
			where: eq(videoClip.taskId, taskId)
		});

		result.videos = clips.map(clip => ({
			id: clip.id,
			downloadStatus: clip.downloadStatus ?? 'pending',
			sourceVideoUrl: clip.sourceVideoUrl,
			duration: clip.duration ?? null,
			width: clip.width,
			height: clip.height
		}));
	} else if (task.taskType === 'image') {
		// 查询关联的宣传图
		const images = await db.query.promotionalImage.findMany({
			where: eq(promotionalImage.taskId, taskId)
		});

		result.images = images.map(img => ({
			id: img.id,
			downloadStatus: 'completed', // 图片是同步生成的，直接标记为完成
			sourceImageUrl: null, // 不需要临时URL，直接使用本地路径
			path: img.path,
			width: img.width,
			height: img.height
		}));
	}

	return result;
}

/**
 * 更新任务状态
 */
export async function updateTaskStatus(
	taskId: string,
	status: 'pending' | 'analyzing' | 'scripting' | 'storyboarding' | 'generating_frames' | 'generating_videos' | 'generating_images' | 'compositing' | 'completed' | 'failed' | 'cancelled',
	errorMessage?: string | null
): Promise<void> {
	const updateData: any = { status };

	const processingStatuses = ['analyzing', 'scripting', 'storyboarding', 'generating_frames', 'generating_videos', 'generating_images', 'compositing'];
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
 * 删除任务（软删除或硬删除）
 */
export async function deleteTask(taskId: string, userId: string): Promise<boolean> {
	// 验证任务属于该用户
	const task = await db.query.generationTask.findFirst({
		where: and(
			eq(generationTask.id, taskId),
			eq(generationTask.userId, userId)
		)
	});

	if (!task) {
		return false;
	}

	// 硬删除（也会级联删除相关的视频片段或图片）
	await db.delete(generationTask).where(eq(generationTask.id, taskId));

	return true;
}

/**
 * 获取任务统计信息
 */
export async function getTaskStats(userId: string, taskType?: 'video' | 'image'): Promise<{
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

	const processingStatuses = ['analyzing', 'scripting', 'storyboarding', 'generating_frames', 'generating_videos', 'generating_images', 'compositing'];

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
	// 验证任务属于该用户且状态为失败
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
	
	if (task.taskType === 'video') {
		jobId = await sendUgcVideoWorkflowJob(taskId, true);
	} else if (task.taskType === 'image') {
		jobId = await sendImageGenerationWorkflowJob(taskId);
	}

	// 获取更新后的任务
	const updatedTask = await getTaskById(taskId);

	if (!updatedTask) {
		return null;
	}

	return { task: updatedTask, jobId };
}
