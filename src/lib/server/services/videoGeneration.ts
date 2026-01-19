// src/lib/server/services/videoGeneration.ts
import { db } from '../db/index.js';
import { videoClip, productImage, type ShotBreakdown } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { localStorage } from '../storage/local.js';
import { readFile } from 'fs/promises';
import type {
	VideoTaskStatus,
	VideoAspectRatio,
	VideoGenerationRequest,
	VideoGenerationResponse,
	VideoStatusResponse,
	CreateVideoTaskResult,
	VideoStatusResult,
	BatchUpdateResult
} from './videoGeneration.types';

const VOLCANO_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const VOLCANO_API_KEY = process.env.VOLCANO_API_KEY;
const SEEDANCE_MODEL = 'doubao-seedance-1-5-pro-251215';

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
		url: string; // 可以是 URL 或 data:image/png;base64,xxx
	};
	role?: 'first_frame' | 'last_frame' | 'reference_image';
}

type ContentItem = TextContent | ImageContent;

/**
 * 检查 API Key 是否配置
 */
function checkApiKey() {
	if (!VOLCANO_API_KEY) {
		throw new Error('VOLCANO_API_KEY environment variable is not set');
	}
	return VOLCANO_API_KEY;
}

/**
 * 将图片转换为 base64 数据
 * 参考 productAnalysis.ts 的实现
 * 
 * @param imagePath - 图片路径
 * @returns base64 数据 URI (data:image/png;base64,...)
 */
async function imageToBase64(imagePath: string): Promise<string> {
	const fullPath = localStorage.getFullPath(imagePath);
	const buffer = await readFile(fullPath);
	
	// 根据文件扩展名确定 MIME 类型
	const ext = imagePath.split('.').pop()?.toLowerCase();
	const mimeType = ext === 'png' ? 'image/png' :
	                 ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
	                 ext === 'webp' ? 'image/webp' :
	                 'image/jpeg';
	
	const base64Data = buffer.toString('base64');
	return `data:${mimeType};base64,${base64Data}`;
}

/**
 * 批量获取产品图片的 base64 数据
 * 
 * @param imageIds - 图片ID列表（从 task.productImageIds 获取）
 * @returns 产品图片 base64 数据 URI 列表
 */
export async function getProductImageUrlsByIds(imageIds: string[]): Promise<string[]> {
	if (imageIds.length === 0) {
		return [];
	}

	console.log(`Loading ${imageIds.length} product images by IDs`);

	// 从数据库获取产品图片
	const images = await db.query.productImage.findMany({
		where: inArray(productImage.id, imageIds)
	});

	console.log(`Found ${images.length} product images`);

	// 转换为 base64
	const urls = await Promise.all(
		images.map(img => imageToBase64(img.path))
	);

	console.log(`Successfully converted ${urls.length} images to base64`);
	return urls;
}

/**
 * 下载视频到本地存储
 * 
 * @param videoUrl - 视频URL（AI供应商返回的临时URL）
 * @param videoClipId - 视频片段ID
 * @returns 本地存储路径
 */
async function downloadVideoToLocal(videoUrl: string, videoClipId: string): Promise<string> {
	try {
		console.log(`Downloading video from ${videoUrl}`);
		
		// 1. 下载视频
		const response = await fetch(videoUrl);
		if (!response.ok) {
			throw new Error(`Failed to download video: ${response.statusText}`);
		}
		
		const buffer = Buffer.from(await response.arrayBuffer());
		
		// 2. 生成本地路径
		const fileName = `${videoClipId}.mp4`;
		const localPath = `videos/${fileName}`;
		
		// 3. 保存到本地存储
		await localStorage.upload(buffer, localPath);
		
		console.log(`Video saved to local storage: ${localPath}`);
		return localPath;
	} catch (error) {
		console.error(`Failed to download video:`, error);
		throw error;
	}
}

/**
 * 组装视频生成提示词
 * 基于分镜的详细描述字段组装成适合 Seedance 模型的提示词
 */
export function buildVideoPrompt(shot: ShotBreakdown): string {
	const parts: string[] = [];

	// 1. 动作描述（核心）
	if (shot.action) {
		parts.push(`Action: ${shot.action}`);
	}

	// 2. 镜头运动
	if (shot.cameraMovement) {
		parts.push(`Camera movement: ${shot.cameraMovement}`);
	}

	// 3. 镜头类型
	if (shot.shotType) {
		parts.push(`Shot type: ${shot.shotType}`);
	}

	// 4. 镜头角度
	if (shot.cameraAngle) {
		parts.push(`Camera angle: ${shot.cameraAngle}`);
	}

	// // 5. 场景描述（地点+时间）
	// const sceneDesc: string[] = [];
	// if (shot.locationDescription) {
	// 	sceneDesc.push(shot.locationDescription);
	// }
	// if (shot.timeDescription) {
	// 	sceneDesc.push(shot.timeDescription);
	// }
	// if (sceneDesc.length > 0) {
	// 	parts.push(`Scene: ${sceneDesc.join(', ')}`);
	// }

	// // 6. 氛围
	// if (shot.atmosphere) {
	// 	parts.push(`Atmosphere: ${shot.atmosphere}`);
	// }

	// // 7. 情绪基调
	// if (shot.mood) {
	// 	parts.push(`Mood: ${shot.mood}`);
	// }

	// // 8. 结果描述
	// if (shot.result) {
	// 	parts.push(`Result: ${shot.result}`);
	// }

	// // 9. 光线
	// if (shot.lighting) {
	// 	parts.push(`Lighting: ${shot.lighting}`);
	// }

	// 10. 产品呈现
	if (shot.productAppearance && shot.productAppearance !== '无产品') {
		parts.push(`Product: ${shot.productAppearance}`);
	}

	return parts.join('. ');
}

/**
 * 创建视频生成任务
 * 
 * @param shot - 分镜数据
 * @param taskId - UGC任务ID
 * @param scriptId - 脚本ID
 * @param aspectRatio - 视频比例
 * @param productImageUrls - 产品图片URL列表（当shot需要产品时使用）
 * @param firstFrameImageBase64 - 可选的首帧图片（base64编码）
 * @param lastFrameImageBase64 - 可选的末帧图片（base64编码）
 * @param generateAudio - 是否生成音频（默认false）
 * @param draft - 是否开启样片模式（默认true，480p预览，消耗更少token）
 * @returns 视频生成任务信息
 */
export async function createVideoGenerationTask(
	shot: ShotBreakdown,
	taskId: string,
	scriptId: string,
	aspectRatio: VideoAspectRatio = '9:16',
	productImageUrls: string[] = [],
	firstFrameImageBase64?: string,
	lastFrameImageBase64?: string,
	generateAudio: boolean = true,
	draft: boolean = true
): Promise<CreateVideoTaskResult> {
	const apiKey = checkApiKey();

	// 1. 构建提示词
	const prompt = buildVideoPrompt(shot);

	// 2. 构建 content 数组
	const content: ContentItem[] = [
		{
			type: 'text',
			text: prompt
		}
	];

	// 添加首帧图片
	if (firstFrameImageBase64) {
		content.push({
			type: 'image_url',
			image_url: {
				url: `data:image/png;base64,${firstFrameImageBase64}`
			},
			role: 'first_frame'
		});
	}

	// 添加末帧图片
	if (lastFrameImageBase64) {
		content.push({
			type: 'image_url',
			image_url: {
				url: `data:image/png;base64,${lastFrameImageBase64}`
			},
			role: 'last_frame'
		});
	}

	// 如果分镜要求产品出现，添加产品参考图片
	// if (shot.requiresProductInFrame && productImageUrls.length > 0) {
	// 	console.log(`Shot ${shot.shotNumber} requires product, adding ${productImageUrls.length} reference images`);
		
	// 	for (const imageUrl of productImageUrls) {
	// 		content.push({
	// 			type: 'image_url',
	// 			image_url: {
	// 				url: imageUrl
	// 			},
	// 			role: 'reference_image'
	// 		});
	// 	}
	// }

	// 3. 构建请求参数
	const requestBody: VideoGenerationRequest = {
		model: SEEDANCE_MODEL,
		content,
		ratio: aspectRatio,
		duration: -1,  // 默认-1，让API自动决定视频长度
		watermark: false,
		generate_audio: generateAudio,
		draft  // 样片模式：true=480p预览（快速+低成本），false=正式视频
	};

	// 4. 调用火山引擎 API
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
		throw new Error(`Failed to create video generation task: ${JSON.stringify(error)}`);
	}

	const result: VideoGenerationResponse = await response.json();

	// 获取任务ID（API返回的是 id 字段）
	const videoTaskId = result.id;
	
	if (!videoTaskId) {
		throw new Error('Video generation response missing task ID');
	}

	// 5. 保存到数据库
	const [videoClipRecord] = await db
		.insert(videoClip)
		.values({
			taskId,
			scriptId,
			shotIds: [shot.id],
			duration: shot.duration,
			provider: 'bytedance',
			model: SEEDANCE_MODEL,
			operationId: videoTaskId,  // 使用返回的视频任务ID
			aiPrompt: prompt,
			status: 'queued',  // 初始状态为排队中
			downloadStatus: 'pending'
		})
		.returning();

	return {
		videoClipId: videoClipRecord.id,
		taskId: videoTaskId,
		operationId: videoTaskId
	};
}

/**
 * 查询视频生成任务状态
 * 
 * @param operationId - 任务ID（火山引擎返回的task_id）
 * @returns 任务状态和结果
 */
export async function getVideoGenerationStatus(
	operationId: string
): Promise<VideoStatusResponse> {
	const apiKey = checkApiKey();

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
		throw new Error(`Failed to get video generation status: ${JSON.stringify(error)}`);
	}

	return await response.json();
}

/**
 * 更新视频片段状态
 * 定期轮询检查视频生成状态，并更新数据库
 * 
 * @param videoClipId - 视频片段ID
 */
export async function updateVideoClipStatus(videoClipId: string): Promise<VideoStatusResult> {
	// 1. 从数据库获取视频片段信息
	const [clip] = await db
		.select()
		.from(videoClip)
		.where(eq(videoClip.id, videoClipId))
		.limit(1);

	if (!clip || !clip.operationId) {
		throw new Error('Video clip not found or missing operation ID');
	}

	// 如果已经是终态（成功、失败或过期），不再查询
	const terminalStatuses: VideoTaskStatus[] = ['succeeded', 'failed', 'expired', 'cancelled'];
	if (terminalStatuses.includes(clip.status)) {
		return {
			status: clip.status,
			videoUrl: clip.sourceVideoUrl || undefined,
			updated: false
		};
	}

	// 2. 查询火山引擎任务状态
	const taskStatus = await getVideoGenerationStatus(clip.operationId);

	// 3. 如果状态没变化，直接返回
	if (clip.status === taskStatus.status) {
		return {
			status: clip.status,
			videoUrl: clip.sourceVideoUrl || undefined,
			updated: false
		};
	}

	// 4. 根据新状态更新数据库
	let updated = false;

	if (taskStatus.status === 'succeeded') {
		// 视频生成成功，更新状态并开始下载
		await db
			.update(videoClip)
			.set({
				sourceVideoUrl: taskStatus.content.video_url,
				status: taskStatus.status,
				downloadStatus: 'downloading'
			})
			.where(eq(videoClip.id, videoClipId));
		
		updated = true;

		// 异步下载视频到本地（不阻塞返回）
		downloadVideoToLocal(taskStatus.content.video_url, videoClipId)
			.then(async (localPath) => {
				// 下载成功
				await db
					.update(videoClip)
					.set({
						path: localPath,
						downloadStatus: 'completed',
						downloadedAt: new Date()
					})
					.where(eq(videoClip.id, videoClipId));
				console.log(`Video downloaded successfully: ${localPath}`);
			})
			.catch(async (error) => {
				// 下载失败
				console.error(`Failed to download video for clip ${videoClipId}:`, error);
				await db
					.update(videoClip)
					.set({
						downloadStatus: 'failed'
					})
					.where(eq(videoClip.id, videoClipId));
			});

		return {
			status: taskStatus.status,
			videoUrl: taskStatus.content.video_url,
			updated
		};
	} else {
		// 状态变化（queued → running，或变为 failed/expired/cancelled）
		await db
			.update(videoClip)
			.set({
				status: taskStatus.status
			})
			.where(eq(videoClip.id, videoClipId));
		
		updated = true;

		return {
			status: taskStatus.status,
			videoUrl: clip.sourceVideoUrl || undefined,
			updated
		};
	}
}

/**
 * 批量创建视频生成任务
 * 将所有分镜合并成一个视频任务（字节支持最长12秒）
 * 
 * @param shots - 分镜列表（总时长需≤12秒）
 * @param task - UGC任务对象
 * @param script - 脚本对象
 * @param generateAudio - 是否生成音频（默认true）
 * @param draft - 是否开启样片模式（默认true，480p预览，消耗更少token）
 * @returns 创建的任务信息
 */
export async function batchCreateVideoTasks(
	shots: ShotBreakdown[],
	task: { id: string; productImageIds: string[] | null; aspectRatio: string },
	script: { id: string },
	generateAudio: boolean = true,
	draft: boolean = true
): Promise<CreateVideoTaskResult> {
	const apiKey = checkApiKey();

	if (shots.length === 0) {
		throw new Error('No shots provided');
	}

	// 1. 获取产品图片URLs
	const productImageUrls = await getProductImageUrlsByIds(task.productImageIds || []);
	console.log(`Loaded ${productImageUrls.length} product images for task ${task.id}`);

	// 2. 从 task 中获取 aspectRatio
	const aspectRatio = task.aspectRatio as VideoAspectRatio;

	// 3. 合并所有分镜的提示词
	const combinedPrompt = shots.map((shot, index) => {
		const shotPrompt = buildVideoPrompt(shot);
		return `[镜头 ${index + 1}/${shots.length}]\n${shotPrompt}`;
	}).join('\n\n');

	console.log(`Combined ${shots.length} shots into single video task`);

	// 4. 构建 content 数组
	const content: ContentItem[] = [
		{
			type: 'text',
			text: combinedPrompt
		}
	];

	// 4. 如果任意分镜需要产品，添加产品参考图片
	const requiresProduct = shots.some(shot => shot.requiresProductInFrame);
	if (requiresProduct && productImageUrls.length > 0) {
		console.log(`Video requires product, adding ${productImageUrls.length} reference images`);
		
		content.push({
			type: 'image_url',
			image_url: {
				url: productImageUrls[0]
			},
			role: 'first_frame'
		});

		// for (const imageUrl of productImageUrls) {
		// 	content.push({
		// 		type: 'image_url',
		// 		image_url: {
		// 			url: imageUrl
		// 		},
		// 		role: 'reference_image'
		// 	});
		// }
	}

	// 5. 构建请求参数
	const requestBody: VideoGenerationRequest = {
		model: SEEDANCE_MODEL,
		content,
		ratio: aspectRatio,
		duration: -1,  // 默认-1，让API自动决定视频长度
		watermark: false,
		generate_audio: generateAudio,
		draft  // 样片模式：true=480p预览（快速+低成本），false=正式视频
	};

	// 6. 调用火山引擎 API
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
		throw new Error(`Failed to create video generation task: ${JSON.stringify(error)}`);
	}

	const result: VideoGenerationResponse = await response.json();

	// 获取任务ID（API返回的是 id 字段）
	const apiTaskId = result.id;
	
	if (!apiTaskId) {
		throw new Error('Video generation response missing task ID');
	}

	// 7. 计算总时长
	const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);

	// 8. 保存到数据库（包含所有 shot IDs）
	const [videoClipRecord] = await db
		.insert(videoClip)
		.values({
			taskId: task.id,
			scriptId: script.id,
			shotIds: shots.map(shot => shot.id),  // 保存所有分镜ID
			duration: totalDuration,
			provider: 'bytedance',
			model: SEEDANCE_MODEL,
			operationId: apiTaskId,  // 使用返回的任务ID
			aiPrompt: combinedPrompt,
			status: 'queued',  // 初始状态为排队中
			downloadStatus: 'pending'
		})
		.returning();

	return {
		videoClipId: videoClipRecord.id,
		taskId: apiTaskId,
		operationId: apiTaskId
	};
}

/**
 * 批量更新视频任务状态
 * 
 * @param videoClipIds - 视频片段ID列表
 * @returns 更新结果
 */
export async function batchUpdateVideoStatus(
	videoClipIds: string[]
): Promise<BatchUpdateResult[]> {
	const results: BatchUpdateResult[] = [];

	for (const clipId of videoClipIds) {
		try {
			const result = await updateVideoClipStatus(clipId);
			results.push({
				videoClipId: clipId,
				status: result.status,
				videoUrl: result.videoUrl
			});
		} catch (error) {
			console.error(`Failed to update video status for ${clipId}:`, error);
			results.push({
				videoClipId: clipId,
				status: 'failed' as VideoTaskStatus,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	}

	return results;
}
