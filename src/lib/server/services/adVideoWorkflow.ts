// src/lib/server/services/adVideoWorkflow.ts
/**
 * 广告视频生成完整工作流
 * 
 * 流程：
 * 1. 分析产品（支持缓存复用：同一产品图片只分析一次）
 * 2. 生成广告文案（支持缓存复用：同一产品图片只生成一次，1:1绑定，含BGM标签）
 * 3. 检查该文案是否已有分镜，有则复用，没有则生成4个画面描述/分镜
 * 4. 生成2x2分镜网格图（Gemini，参考产品图片）
 * 5. 切分网格图为4张独立图片
 * 6. 基于首帧生成4个视频（Ark Seedance，静音，每个场景一个视频）
 * 7. TTS生成旁白音频并切分（跳过无旁白的场景）
 * 8. 音频与视频匹配（必要时加速音频，无旁白的视频保持静音）
 * 9. 搜索并下载BGM（Jamendo，基于文案生成的bgmTags）
 * 10. 合成最终广告视频（旁白 + BGM混音）
 */

import { db } from '../db';
import { product, adCopy, adStoryboard, type GenerationTask, type Product, type AdCopy, type AdStoryboard } from '../db/schema';
import { eq } from 'drizzle-orm';
import { analyzeAndCreateProduct } from './productAnalysis';
import { generateAndSaveAdCopy } from './adCopyGeneration';
import { generateAndSaveStoryboard, type StoryboardScene } from './adStoryboardGeneration';
import { generateAndSplitStoryboardImages } from './adStoryboardImageGeneration';
import { createAdVideoTasks, batchUpdateAdVideoStatus, waitForAdVideosDownloaded } from './adVideoGeneration';
import { generateFullNarrationAudio, splitAudioByScenes } from './adTtsService';
import { composeFinalAdVideo } from './adVideoComposition';
import { searchAndDownloadBgm } from './adBgmService';
import { updateTaskStatus } from './ugcTask';
import { extractErrorMessage, logError } from './utils/errorHandler';
import type { VideoAspectRatio } from './videoGeneration.types';

/**
 * 广告视频工作流状态
 */
export type AdVideoWorkflowStatus =
	| 'pending'
	| 'analyzing'
	| 'scripting'         // 生成文案
	| 'storyboarding'     // 生成分镜
	| 'generating_frames' // 生成分镜图并切分
	| 'generating_videos' // 生成4个视频
	| 'generating_audio'  // TTS + 切分音频
	| 'compositing'       // 合成最终视频
	| 'completed'
	| 'failed';

/**
 * 广告视频工作流结果
 */
export interface AdVideoWorkflowResult {
	status: AdVideoWorkflowStatus;
	productId?: string;
	adCopyId?: string;
	storyboardId?: string;
	gridImageId?: string;
	frameIds?: string[];
	videoClipIds?: string[];
	audioIds?: string[];
	bgmId?: string;
	finalVideoId?: string;
	finalVideoPath?: string;
	error?: string;
}

/**
 * 查找已有的产品分析结果
 * 直接通过 productImageId 查找，因为 product 与 productImage 是 1:1 关系
 */
async function findExistingProduct(productImageId: string): Promise<Product | null> {
	const existingProduct = await db.query.product.findFirst({
		where: eq(product.productImageId, productImageId)
	});
	return existingProduct || null;
}

/**
 * 查找已有的广告文案
 * 直接通过 productImageId 查找，因为 adCopy 与 productImage 是 1:1 关系
 */
async function findExistingAdCopy(productImageId: string): Promise<AdCopy | null> {
	const existingCopy = await db.query.adCopy.findFirst({
		where: eq(adCopy.productImageId, productImageId)
	});
	return existingCopy || null;
}

/**
 * 查找某条广告文案是否已有对应的分镜
 */
async function findExistingStoryboard(adCopyId: string): Promise<{
	storyboardRecord: AdStoryboard;
	scenes: StoryboardScene[];
} | null> {
	const existingStoryboard = await db.query.adStoryboard.findFirst({
		where: eq(adStoryboard.adCopyId, adCopyId)
	});

	if (!existingStoryboard) {
		return null;
	}

	return {
		storyboardRecord: existingStoryboard,
		scenes: existingStoryboard.scenes as StoryboardScene[]
	};
}

/**
 * 执行完整的广告视频生成工作流
 */
export async function executeAdVideoWorkflow(
	task: GenerationTask
): Promise<AdVideoWorkflowResult> {
	const startTime = Date.now();

	try {
		// ============================================
		// Step 1: 分析产品（支持缓存复用）
		// ============================================
		console.log('\n📦 Step 1: Analyzing product...');
		await updateTaskStatus(task.id, 'analyzing');

		let productRecord: Product;
		const productImageId = task.productImageId;

		const existingProduct = await findExistingProduct(productImageId);
		if (existingProduct) {
			console.log(`✅ Product already analyzed (reusing): ${existingProduct.name} [id=${existingProduct.id}]`);
			productRecord = existingProduct;
		} else {
			const { product: newProduct } = await analyzeAndCreateProduct(task);
			console.log(`✅ Product analyzed (new): ${newProduct.name}`);
			productRecord = newProduct;
		}

		// ============================================
		// Step 2: 生成广告文案（支持缓存复用，1:1绑定productImage）
		// ============================================
		console.log('\n✍️ Step 2: Generating ad copy...');
		await updateTaskStatus(task.id, 'scripting');

		let selectedAdCopy: AdCopy;

		const existingAdCopy = await findExistingAdCopy(productImageId);
		if (existingAdCopy) {
			console.log(`✅ Ad copy already generated (reusing): [${existingAdCopy.style}] "${existingAdCopy.title}"`);
			selectedAdCopy = existingAdCopy;
		} else {
			const { adCopyRecord } = await generateAndSaveAdCopy(productImageId, productRecord);
			console.log(`✅ Ad copy generated: [${adCopyRecord.style}] "${adCopyRecord.title}"`);
			selectedAdCopy = adCopyRecord;
		}

		// ============================================
		// Step 3: 生成4个画面描述（分镜）- 支持缓存复用
		// ============================================
		console.log('\n🎬 Step 3: Generating storyboard (4 scenes)...');
		await updateTaskStatus(task.id, 'storyboarding');

		let storyboardRecord: AdStoryboard;
		let scenes: StoryboardScene[];

		// 检查该文案是否已有分镜
		const existingStoryboard = await findExistingStoryboard(selectedAdCopy.id);
		if (existingStoryboard) {
			console.log(`✅ Storyboard already exists for this ad copy (reusing) [id=${existingStoryboard.storyboardRecord.id}]`);
			storyboardRecord = existingStoryboard.storyboardRecord;
			scenes = existingStoryboard.scenes;
		} else {
			const result = await generateAndSaveStoryboard(task, productRecord, selectedAdCopy);
			storyboardRecord = result.storyboardRecord;
			scenes = result.scenes;
			console.log(`✅ Storyboard generated with ${scenes.length} scenes`);
		}

		scenes.forEach(s => {
			const narrationInfo = s.narration ? `旁白: "${s.narration}"` : '(无旁白)';
			console.log(`   Scene ${s.sceneNumber}: ${s.title} ${narrationInfo}`);
		});

		// ============================================
		// Step 4: 生成分镜网格图并切分为4张图片
		// ============================================
		console.log('\n🖼️ Step 4: Generating storyboard images (2x2 grid)...');
		await updateTaskStatus(task.id, 'generating_frames');

		const aspectRatio = task.aspectRatio || '9:16';
		const { gridImageId, frames } = await generateAndSplitStoryboardImages(
			task,
			storyboardRecord,
			scenes,
			aspectRatio
		);
		console.log(`✅ Generated grid image and split into ${frames.length} frames`);

		// ============================================
		// Step 5: 基于首帧生成4个视频（静音）
		// ============================================
		console.log('\n🎥 Step 5: Generating 4 videos from first frames...');
		await updateTaskStatus(task.id, 'generating_videos');

		const videoTasks = await createAdVideoTasks(
			task,
			storyboardRecord,
			frames,
			scenes.map(s => ({
				sceneNumber: s.sceneNumber,
				videoPrompt: s.videoPrompt,
				duration: s.duration
			})),
			aspectRatio as VideoAspectRatio
		);
		console.log(`✅ Created ${videoTasks.length} video generation tasks`);

		const videoClipIds = videoTasks.map(v => v.videoClipId);

		// ============================================
		// Step 6: 等待视频生成完成
		// ============================================
		console.log('\n⏳ Step 6: Polling video generation status...');

		const maxPollAttempts = 120;
		const pollInterval = 10000;

		for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
			await new Promise(resolve => setTimeout(resolve, pollInterval));

			const statuses = await batchUpdateAdVideoStatus(videoClipIds);
			
			const completed = statuses.filter(s => s.status === 'succeeded').length;
			const failed = statuses.filter(s => s.status === 'failed').length;
			const pending = statuses.length - completed - failed;

			console.log(`   Attempt ${attempt + 1}/${maxPollAttempts}: Completed ${completed}, Failed ${failed}, Pending ${pending}`);

			if (pending === 0) {
				if (failed > 0 && completed === 0) {
					throw new Error('All video generation tasks failed');
				}
				break;
			}
		}

		// 等待视频下载完成
		console.log('\n⬇️ Waiting for video downloads...');
		const downloadedClips = await waitForAdVideosDownloaded(videoClipIds, 60, 5000);
		console.log(`✅ All ${downloadedClips.length} videos downloaded`);

		// ============================================
		// Step 7: TTS 生成旁白音频（只为有旁白的场景生成）
		// ============================================
		console.log('\n🎤 Step 7: Generating narration audio (TTS)...');
		await updateTaskStatus(task.id, 'compositing');

		const { fullAudioPath, fullAudioDuration, fullAudioId, words, sceneNarrations, scenesWithNarration } = 
			await generateFullNarrationAudio(
				task,
				storyboardRecord,
				scenes.map(s => ({
					sceneNumber: s.sceneNumber,
					narration: s.narration
				}))
			);
		console.log(`✅ Full narration generated: ${fullAudioDuration}ms (${scenesWithNarration.length} scenes with narration)`);

		// ============================================
		// Step 8: 切分音频为对应视频的段
		// ============================================
		console.log('\n✂️ Step 8: Splitting audio into segments...');

		const audioSegments = await splitAudioByScenes(
			task,
			storyboardRecord,
			fullAudioPath,
			words,
			sceneNarrations
		);
		console.log(`✅ Audio split into ${audioSegments.length} segments (some videos may be silent)`);

		// ============================================
		// Step 9: 搜索并下载 BGM（Jamendo）
		// ============================================
		console.log('\n🎵 Step 9: Searching and downloading BGM...');

		const totalVideoDuration = downloadedClips.reduce((sum, c) => sum + c.duration, 0);
		let bgmInfo: { bgmId: string; bgmPath: string; trackName: string; artistName: string; duration: number } | undefined;

		try {
			bgmInfo = await searchAndDownloadBgm(task, selectedAdCopy, totalVideoDuration);
			console.log(`✅ BGM ready: "${bgmInfo.trackName}" by ${bgmInfo.artistName} (${bgmInfo.duration}s)`);
		} catch (error) {
			console.warn(`⚠️ BGM search/download failed, proceeding without BGM:`, error instanceof Error ? error.message : error);
		}

		// ============================================
		// Step 10: 合成最终广告视频（旁白 + BGM混音）
		// ============================================
		console.log('\n🎬 Step 10: Composing final ad video...');

		// 准备视频片段数据（按 clipNumber 排序）
		const videoClipsForComposition = downloadedClips
			.sort((a, b) => a.clipNumber - b.clipNumber)
			.map(clip => ({
				clipId: clip.clipId,
				clipNumber: clip.clipNumber,
				path: clip.path,
				duration: clip.duration
			}));

		const { finalVideoId, finalVideoPath, totalDuration } = await composeFinalAdVideo(
			task,
			videoClipsForComposition,
			audioSegments,
			bgmInfo ? { bgmId: bgmInfo.bgmId, bgmPath: bgmInfo.bgmPath } : undefined
		);

		// 更新任务状态为完成
		await updateTaskStatus(task.id, 'completed');

		const totalTime = Date.now() - startTime;
		console.log(`\n🎉 Ad video workflow completed!`);
		console.log(`   Final video: ${finalVideoPath} (${totalDuration}s)`);
		console.log(`   Total time: ${(totalTime / 1000).toFixed(1)}s`);

		return {
			status: 'completed',
			productId: productRecord.id,
			adCopyId: selectedAdCopy.id,
			storyboardId: storyboardRecord.id,
			gridImageId,
			frameIds: frames.map(f => f.id),
			videoClipIds,
			audioIds: audioSegments.map(a => a.audioId),
			bgmId: bgmInfo?.bgmId,
			finalVideoId,
			finalVideoPath
		};

	} catch (error) {
		logError('Ad video workflow', error);
		
		const errorMessage = extractErrorMessage(error);
		await updateTaskStatus(task.id, 'failed', errorMessage);

		return {
			status: 'failed',
			error: errorMessage
		};
	}
}
