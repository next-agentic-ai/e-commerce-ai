// src/lib/server/services/adStoryboardImageGeneration.ts
/**
 * 广告分镜图片生成服务
 * 使用 Gemini AI 生成 2x2 分镜网格图，然后切分为4张独立图片
 */

import { db } from '../db';
import { adStoryboardImage, productImage, type GenerationTask, type AdStoryboard } from '../db/schema';
import { localStorage } from '../storage/local';
import { writeFile, mkdir } from 'fs/promises';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { getGeminiClient } from './utils/apiClients';
import { imagesToInlineData } from './utils/imageUtils';
import { eq } from 'drizzle-orm';
import type { StoryboardScene } from './adStoryboardGeneration';

const IMAGE_MODEL = 'gemini-3-pro-image-preview';

/**
 * 获取产品参考图片（内联数据格式）
 */
async function getProductImageFiles(imageIds: string[]): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
	if (imageIds.length === 0) {
		return [];
	}

	const images = await db.query.productImage.findMany({
		where: (pi, { inArray }) => inArray(pi.id, imageIds),
		columns: {
			path: true
		}
	});

	const imagePaths = images.map(img => img.path);
	return await imagesToInlineData(imagePaths);
}

/**
 * 生成 2x2 分镜网格图
 */
export async function generateStoryboardGridImage(
	task: GenerationTask,
	storyboardRecord: AdStoryboard,
	scenes: StoryboardScene[],
	aspectRatio: string = '9:16'
): Promise<{
	gridImagePath: string;
	gridImageWidth: number;
	gridImageHeight: number;
	gridImageFileSize: number;
	gridImageId: string;
}> {
	const ai = getGeminiClient();
	const startTime = Date.now();

	// 1. 构建场景描述（使用 imagePrompt，专门为首帧图生成设计的prompt）
	const sceneDescriptions = scenes.map((scene, i) => {
		return `画面${i + 1}（${scene.title}）：${scene.imagePrompt}`;
	}).join('\n\n');

	// 2. 构建提示词
	const prompt = `请生成一张 2×2 网格的广告视频分镜图。

## 要求
- 整张图片是一个 2×2 的网格布局（2列2行，共4个画面）
- 每个格子是一个 ${aspectRatio} 的竖版画面
- 4个画面按顺序排列：
  第1行：左(画面1) → 右(画面2)
  第2行：左(画面3) → 右(画面4)
- 画面之间要有视觉连贯性（色调、风格统一）
- 画面描述中涉及产品的画面，产品外观要参考附带的产品图片
- 画面风格要专业、有广告质感
- 不要在画面上添加任何文字
- 每个格子之间不需要间隔或边框

## 4个画面描述

${sceneDescriptions}

## 重要
- 这是一个广告视频分镜，画面要有电影感
- 产品出现时要清晰可辨识，参考产品图片的外观
- 整体色调统一协调
- 每个画面的构图要符合 ${aspectRatio} 竖版画面的最佳实践`;

	// 3. 获取产品参考图片
	const productImages = await getProductImageFiles(task.productImageId ? [task.productImageId] : []);
	console.log(`📷 Loaded ${productImages.length} product reference images for storyboard`);

	// 4. 构建请求内容
	const contents = [
		{
			role: 'user',
			parts: [
				{ text: prompt },
				...productImages
			]
		}
	];

	// 5. 调用 Gemini API
	console.log('🎨 Generating 2x2 storyboard grid image...');
	const response = await ai.models.generateContent({
		model: IMAGE_MODEL,
		contents,
		config: {
			imageConfig: {
				imageSize: '2K'
			},
			responseModalities: ['Image']
		}
	});

	// 6. 处理响应
	if (!response.candidates || response.candidates.length === 0) {
		throw new Error('No candidates returned from Gemini API for storyboard');
	}

	const candidate = response.candidates[0];
	if (!candidate?.content?.parts) {
		throw new Error('Invalid response structure from Gemini API');
	}

	let imageBuffer: Buffer | null = null;
	for (const part of candidate.content.parts) {
		if (part.inlineData?.data) {
			imageBuffer = Buffer.from(part.inlineData.data, 'base64');
			console.log(`🖼️ Received storyboard grid image (${imageBuffer.length} bytes)`);
		}
	}

	if (!imageBuffer) {
		throw new Error('No image data received from Gemini API for storyboard');
	}

	// 7. 保存网格图
	const taskDir = `ad_storyboard/${task.id}`;
	const fullDir = localStorage.getFullPath(taskDir);
	await mkdir(fullDir, { recursive: true });

	const timestamp = Date.now();
	const randomStr = randomBytes(4).toString('hex');
	const gridFilename = `grid_${timestamp}_${randomStr}.png`;
	const gridPath = `${taskDir}/${gridFilename}`;
	const fullGridPath = localStorage.getFullPath(gridPath);

	await writeFile(fullGridPath, imageBuffer);

	// 获取图片尺寸
	const metadata = await sharp(imageBuffer).metadata();
	if (!metadata.width || !metadata.height) {
		throw new Error('Failed to get grid image dimensions');
	}

	const generationTime = Date.now() - startTime;

	// 8. 保存到数据库
	const [gridRecord] = await db
		.insert(adStoryboardImage)
		.values({
			taskId: task.id,
			storyboardId: storyboardRecord.id,
			imageType: 'grid',
			sceneNumber: null,
			path: gridPath,
			storageType: 'local',
			width: metadata.width,
			height: metadata.height,
			fileSize: imageBuffer.length,
			provider: 'google',
			model: IMAGE_MODEL,
			usageMetadata: response.usageMetadata,
			generationTime
		})
		.returning();

	console.log(`✅ Grid image saved: ${gridPath} (${metadata.width}x${metadata.height})`);

	return {
		gridImagePath: gridPath,
		gridImageWidth: metadata.width,
		gridImageHeight: metadata.height,
		gridImageFileSize: imageBuffer.length,
		gridImageId: gridRecord.id
	};
}

/**
 * 将 2x2 网格图切分为4张独立图片
 */
export async function splitGridImage(
	task: GenerationTask,
	storyboardRecord: AdStoryboard,
	gridImagePath: string
): Promise<Array<{
	id: string;
	path: string;
	sceneNumber: number;
	width: number;
	height: number;
	fileSize: number;
}>> {
	const fullGridPath = localStorage.getFullPath(gridImagePath);
	
	// 获取网格图尺寸
	const gridMetadata = await sharp(fullGridPath).metadata();
	if (!gridMetadata.width || !gridMetadata.height) {
		throw new Error('Failed to get grid image dimensions for splitting');
	}

	const gridWidth = gridMetadata.width;
	const gridHeight = gridMetadata.height;

	// 计算每个格子的尺寸（2列2行）
	const cellWidth = Math.floor(gridWidth / 2);
	const cellHeight = Math.floor(gridHeight / 2);

	console.log(`Splitting grid (${gridWidth}x${gridHeight}) into 4 cells of ${cellWidth}x${cellHeight}`);

	const taskDir = `ad_storyboard/${task.id}`;
	const results: Array<{
		id: string;
		path: string;
		sceneNumber: number;
		width: number;
		height: number;
		fileSize: number;
	}> = [];

	// 切分4个格子：
	// 第1行：左(1), 右(2)
	// 第2行：左(3), 右(4)
	const positions = [
		{ sceneNumber: 1, left: 0, top: 0 },
		{ sceneNumber: 2, left: cellWidth, top: 0 },
		{ sceneNumber: 3, left: 0, top: cellHeight },
		{ sceneNumber: 4, left: cellWidth, top: cellHeight }
	];

	for (const pos of positions) {
		const timestamp = Date.now();
		const randomStr = randomBytes(4).toString('hex');
		const filename = `frame_${pos.sceneNumber}_${timestamp}_${randomStr}.png`;
		const framePath = `${taskDir}/${filename}`;
		const fullFramePath = localStorage.getFullPath(framePath);

		// 使用 sharp 切分
		const frameBuffer = await sharp(fullGridPath)
			.extract({
				left: pos.left,
				top: pos.top,
				width: cellWidth,
				height: cellHeight
			})
			.toBuffer();

		await writeFile(fullFramePath, frameBuffer);

		// 获取实际尺寸
		const frameMetadata = await sharp(frameBuffer).metadata();

		// 保存到数据库
		const [record] = await db
			.insert(adStoryboardImage)
			.values({
				taskId: task.id,
				storyboardId: storyboardRecord.id,
				imageType: `frame_${pos.sceneNumber}`,
				sceneNumber: pos.sceneNumber,
				path: framePath,
				storageType: 'local',
				width: frameMetadata.width || cellWidth,
				height: frameMetadata.height || cellHeight,
				fileSize: frameBuffer.length
			})
			.returning();

		results.push({
			id: record.id,
			path: framePath,
			sceneNumber: pos.sceneNumber,
			width: frameMetadata.width || cellWidth,
			height: frameMetadata.height || cellHeight,
			fileSize: frameBuffer.length
		});

		console.log(`✅ Frame ${pos.sceneNumber} saved: ${framePath} (${frameMetadata.width}x${frameMetadata.height})`);
	}

	return results;
}

/**
 * 生成分镜图并切分（一步到位）
 */
export async function generateAndSplitStoryboardImages(
	task: GenerationTask,
	storyboardRecord: AdStoryboard,
	scenes: StoryboardScene[],
	aspectRatio: string = '9:16'
): Promise<{
	gridImageId: string;
	frames: Array<{
		id: string;
		path: string;
		sceneNumber: number;
		width: number;
		height: number;
		fileSize: number;
	}>;
}> {
	// 1. 生成网格图
	const gridResult = await generateStoryboardGridImage(task, storyboardRecord, scenes, aspectRatio);

	// 2. 切分为4张图片
	const frames = await splitGridImage(task, storyboardRecord, gridResult.gridImagePath);

	return {
		gridImageId: gridResult.gridImageId,
		frames
	};
}
