// src/lib/server/services/adVideoGeneration.ts
/**
 * 广告视频生成服务
 * 基于首帧图片，使用 Ark Seedance 生成4个视频片段（每个场景一个视频）
 */

import { db } from '../db';
import { adVideoClip, type GenerationTask, type AdStoryboard } from '../db/schema';
import { localStorage } from '../storage/local';
import { eq } from 'drizzle-orm';
import { checkArkApiKey } from './utils/apiClients';
import { imageToBase64WithMime } from './utils/imageUtils';
import { extractVideoMetadata } from './utils/videoUtils';
import type {
	VideoAspectRatio,
	VideoGenerationRequest,
	VideoGenerationResponse,
	VideoStatusResponse,
	VideoTaskStatus
} from './videoGeneration.types';

const VOLCANO_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const SEEDANCE_MODEL = 'doubao-seedance-1-0-pro-fast-251015';

/**
 * 内容类型
 */
interface TextContent {
	type: 'text';
	text: string;
}

interface ImageContent {
	type: 'image_url';
	image_url: {
		url: string;
	};
	role?: 'first_frame' | 'last_frame' | 'reference_image';
}

type ContentItem = TextContent | ImageContent;

/**
 * 创建4个视频生成任务（每个场景一个视频，基于首帧生成）
 * 视频1: 基于 frame1（场景1）
 * 视频2: 基于 frame2（场景2）
 * 视频3: 基于 frame3（场景3）
 * 视频4: 基于 frame4（场景4）
 */
export async function createAdVideoTasks(
	task: GenerationTask,
	storyboardRecord: AdStoryboard,
	frames: Array<{
		id: string;
		path: string;
		sceneNumber: number;
	}>,
	scenes: Array<{
		sceneNumber: number;
		videoPrompt: string;
		duration: number; // 场景时长（秒），2-4秒
	}>,
	aspectRatio: VideoAspectRatio = '9:16'
): Promise<Array<{
	clipNumber: number;
	videoClipId: string;
	operationId: string;
}>> {
	const apiKey = checkArkApiKey();

	// 排序帧确保顺序正确
	const sortedFrames = [...frames].sort((a, b) => a.sceneNumber - b.sceneNumber);

	if (sortedFrames.length !== 4) {
		throw new Error(`Expected 4 frames, got ${sortedFrames.length}`);
	}

	const results: Array<{
		clipNumber: number;
		videoClipId: string;
		operationId: string;
	}> = [];

	// 创建4个视频任务，每个基于对应场景的首帧
	for (const frame of sortedFrames) {
		const clipNumber = frame.sceneNumber;

		// 获取首帧 base64
		const firstFrameBase64 = await imageToBase64WithMime(frame.path);

		// 构建提示词（直接使用 videoPrompt，已包含主体动作 + 镜头语言 + 运镜）
		const scene = scenes.find(s => s.sceneNumber === frame.sceneNumber);
		const prompt = scene?.videoPrompt || '画面中的主体缓慢移动，中景平移镜头，电影质感。';
		const sceneDuration = scene?.duration || 4; // 使用场景指定的时长，默认4秒

		// 构建 content 数组（只有首帧，没有尾帧）
		const content: ContentItem[] = [
			{
				type: 'text',
				text: prompt
			},
			{
				type: 'image_url',
				image_url: {
					url: firstFrameBase64
				},
				role: 'first_frame'
			}
		];

		// 构建请求（duration 基于分镜场景设定的时长）
		const requestBody: VideoGenerationRequest = {
			model: SEEDANCE_MODEL,
			content,
			ratio: aspectRatio,
			duration: sceneDuration,
			resolution: '480p',
			watermark: false,
			generate_audio: false, // 静音生成
			draft: false
		};

		// 调用 API
		console.log(`🎬 Creating video task ${clipNumber}/6 (duration: ${sceneDuration}s)...`);
		const response = await fetch(`${VOLCANO_API_BASE}/contents/generations/tasks`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ error: 'Unknown error' }));
			throw new Error(`Failed to create video task ${clipNumber}: ${JSON.stringify(error)}`);
		}

		const result: VideoGenerationResponse = await response.json();
		const apiTaskId = result.id;

		if (!apiTaskId) {
			throw new Error(`Video generation response missing task ID for clip ${clipNumber}`);
		}

		// 保存到数据库（只有首帧，没有尾帧）
		const [clipRecord] = await db
			.insert(adVideoClip)
			.values({
				taskId: task.id,
				storyboardId: storyboardRecord.id,
				clipNumber,
				firstFrameImageId: frame.id,
				lastFrameImageId: null,
				provider: 'bytedance',
				model: SEEDANCE_MODEL,
				operationId: apiTaskId,
				aiPrompt: prompt,
				status: 'queued',
				downloadStatus: 'pending'
			})
			.returning();

		results.push({
			clipNumber,
			videoClipId: clipRecord.id,
			operationId: apiTaskId
		});

		console.log(`✅ Video task ${clipNumber} created: ${clipRecord.id} (operation: ${apiTaskId})`);
	}

	return results;
}

/**
 * 查询视频生成状态
 */
async function getVideoGenerationStatus(operationId: string): Promise<VideoStatusResponse> {
	const apiKey = checkArkApiKey();

	const response = await fetch(
		`${VOLCANO_API_BASE}/contents/generations/tasks/${operationId}`,
		{
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${apiKey}`
			}
		}
	);

	if (!response.ok) {
		const error = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(`Failed to get video status: ${JSON.stringify(error)}`);
	}

	return await response.json();
}

/**
 * 下载视频到本地
 */
async function downloadVideo(videoUrl: string, clipId: string): Promise<{
	path: string;
	width: number;
	height: number;
	fileSize: number;
	duration: number;
}> {
	console.log(`⬇️ Downloading video for clip ${clipId}...`);
	
	const response = await fetch(videoUrl);
	if (!response.ok) {
		throw new Error(`Failed to download video: ${response.statusText}`);
	}
	
	const buffer = Buffer.from(await response.arrayBuffer());
	const localPath = `ad_videos/${clipId}.mp4`;
	
	await localStorage.upload(buffer, localPath);
	
	const fullPath = localStorage.getFullPath(localPath);
	const metadata = await extractVideoMetadata(fullPath);
	
	if (!metadata.width || !metadata.height || !metadata.fileSize) {
		throw new Error('Failed to get video metadata');
	}
	
	return {
		path: localPath,
		width: metadata.width,
		height: metadata.height,
		fileSize: metadata.fileSize,
		duration: metadata.duration
	};
}

/**
 * 更新单个广告视频片段状态
 */
export async function updateAdVideoClipStatus(clipId: string): Promise<{
	status: VideoTaskStatus;
	videoUrl?: string;
	updated: boolean;
}> {
	const [clip] = await db
		.select()
		.from(adVideoClip)
		.where(eq(adVideoClip.id, clipId))
		.limit(1);

	if (!clip || !clip.operationId) {
		throw new Error('Ad video clip not found or missing operation ID');
	}

	// 已是终态，不再查询
	const terminalStatuses: VideoTaskStatus[] = ['succeeded', 'failed', 'expired', 'cancelled'];
	if (terminalStatuses.includes(clip.status)) {
		return {
			status: clip.status,
			videoUrl: clip.sourceVideoUrl || undefined,
			updated: false
		};
	}

	// 查询 API 状态
	const taskStatus = await getVideoGenerationStatus(clip.operationId);

	if (clip.status === taskStatus.status) {
		return {
			status: clip.status,
			videoUrl: clip.sourceVideoUrl || undefined,
			updated: false
		};
	}

	if (taskStatus.status === 'succeeded') {
		// 更新状态
		await db
			.update(adVideoClip)
			.set({
				sourceVideoUrl: taskStatus.content.video_url,
				status: taskStatus.status,
				downloadStatus: 'downloading'
			})
			.where(eq(adVideoClip.id, clipId));

		// 异步下载
		downloadVideo(taskStatus.content.video_url, clipId)
			.then(async (result) => {
				await db
					.update(adVideoClip)
					.set({
						path: result.path,
						width: result.width,
						height: result.height,
						fileSize: result.fileSize,
						duration: result.duration,
						downloadStatus: 'completed',
						downloadedAt: new Date()
					})
					.where(eq(adVideoClip.id, clipId));
				console.log(`✅ Ad video downloaded: ${result.path} (${result.width}x${result.height}, ${result.duration}s)`);
			})
			.catch(async (error) => {
				console.error(`Failed to download ad video for clip ${clipId}:`, error);
				await db
					.update(adVideoClip)
					.set({ downloadStatus: 'failed' })
					.where(eq(adVideoClip.id, clipId));
			});

		return {
			status: taskStatus.status,
			videoUrl: taskStatus.content.video_url,
			updated: true
		};
	} else {
		// 状态变化
		await db
			.update(adVideoClip)
			.set({ status: taskStatus.status })
			.where(eq(adVideoClip.id, clipId));

		return {
			status: taskStatus.status,
			videoUrl: clip.sourceVideoUrl || undefined,
			updated: true
		};
	}
}

/**
 * 批量更新广告视频状态
 */
export async function batchUpdateAdVideoStatus(clipIds: string[]): Promise<Array<{
	clipId: string;
	status: VideoTaskStatus;
	videoUrl?: string;
	error?: string;
}>> {
	const results: Array<{
		clipId: string;
		status: VideoTaskStatus;
		videoUrl?: string;
		error?: string;
	}> = [];

	for (const clipId of clipIds) {
		try {
			const result = await updateAdVideoClipStatus(clipId);
			results.push({
				clipId,
				status: result.status,
				videoUrl: result.videoUrl
			});
		} catch (error) {
			console.error(`Failed to update ad video status for ${clipId}:`, error);
			results.push({
				clipId,
				status: 'failed',
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	}

	return results;
}

/**
 * 等待所有广告视频完成下载
 */
export async function waitForAdVideosDownloaded(
	clipIds: string[],
	maxAttempts: number = 120,
	pollInterval: number = 5000
): Promise<Array<{
	clipId: string;
	path: string;
	duration: number;
	clipNumber: number;
}>> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		await new Promise(resolve => setTimeout(resolve, pollInterval));

		// 检查所有 clip 的下载状态
		const clips = await Promise.all(
			clipIds.map(async (clipId) => {
				const [clip] = await db
					.select()
					.from(adVideoClip)
					.where(eq(adVideoClip.id, clipId))
					.limit(1);
				return clip;
			})
		);

		const allDownloaded = clips.every(c => c?.downloadStatus === 'completed');
		const anyFailed = clips.some(c => c?.downloadStatus === 'failed' || c?.status === 'failed');

		if (allDownloaded) {
			return clips.map(c => ({
				clipId: c!.id,
				path: c!.path!,
				duration: c!.duration || 5, // 默认5秒
				clipNumber: c!.clipNumber
			}));
		}

		if (anyFailed) {
			throw new Error('Some ad video clips failed to generate or download');
		}

		console.log(`⏳ Waiting for ad video downloads... (attempt ${attempt + 1}/${maxAttempts})`);
	}

	throw new Error('Timeout waiting for ad video downloads');
}
