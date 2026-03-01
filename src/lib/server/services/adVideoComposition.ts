// src/lib/server/services/adVideoComposition.ts
/**
 * 广告视频合成服务
 * 将4个视频片段与对应音频合成为最终广告视频
 * 部分视频片段可能没有对应音频（静音处理）
 */

import { db } from '../db';
import { adFinalVideo, adAudio, type GenerationTask } from '../db/schema';
import { localStorage } from '../storage/local';
import { writeFile, mkdir, stat } from 'fs/promises';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { eq } from 'drizzle-orm';
import { adjustAudioSpeedIfNeeded } from './adTtsService';
import { extractVideoMetadata } from './utils/videoUtils';

const execAsync = promisify(exec);

/**
 * 获取音频时长（毫秒）
 */
async function getAudioDuration(audioPath: string): Promise<number> {
	const fullPath = localStorage.getFullPath(audioPath);
	const { stdout } = await execAsync(
		`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fullPath}"`
	);
	return parseFloat(stdout.trim()) * 1000;
}

/**
 * 获取视频时长（毫秒）
 */
async function getVideoDuration(videoPath: string): Promise<number> {
	const fullPath = localStorage.getFullPath(videoPath);
	const { stdout } = await execAsync(
		`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fullPath}"`
	);
	return parseFloat(stdout.trim()) * 1000;
}

/**
 * 将单个视频与音频合并
 * 如果音频比视频长，先加速音频
 */
async function mergeVideoWithAudio(
	videoPath: string,
	audioPath: string,
	outputPath: string,
	taskId: string
): Promise<void> {
	const fullVideoPath = localStorage.getFullPath(videoPath);
	const fullOutputPath = localStorage.getFullPath(outputPath);

	// 获取视频时长
	const videoDurationMs = await getVideoDuration(videoPath);

	// 调整音频速度（如果需要）
	const { adjustedPath, isAdjusted, speedRatio } = await adjustAudioSpeedIfNeeded(
		audioPath,
		videoDurationMs,
		taskId
	);

	const fullAudioPath = localStorage.getFullPath(adjustedPath);

	console.log(`🔗 Merging: video=${videoPath} (${(videoDurationMs / 1000).toFixed(1)}s), audio=${adjustedPath}`);
	if (isAdjusted) {
		console.log(`🔊 Audio speed adjusted by ${speedRatio.toFixed(2)}x for video ${videoPath}`);
	}

	// 确保输出目录存在
	const outputDir = fullOutputPath.substring(0, fullOutputPath.lastIndexOf('/'));
	await mkdir(outputDir, { recursive: true });

	// 合并视频和音频
	// 以视频长度为准：音频短于视频时，视频后半段自然无声
	// 音频已经通过 adjustAudioSpeedIfNeeded 确保不会比视频长
	await execAsync(
		`ffmpeg -y -i "${fullVideoPath}" -i "${fullAudioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 "${fullOutputPath}"`
	);

	console.log(`✅ Merged video+audio: ${outputPath}`);
}

/**
 * 为静音视频添加静音音轨（确保 concat 时编码一致）
 */
async function addSilentAudioTrack(
	videoPath: string,
	outputPath: string
): Promise<void> {
	const fullVideoPath = localStorage.getFullPath(videoPath);
	const fullOutputPath = localStorage.getFullPath(outputPath);

	// 确保输出目录存在
	const outputDir = fullOutputPath.substring(0, fullOutputPath.lastIndexOf('/'));
	await mkdir(outputDir, { recursive: true });

	// 添加静音音轨
	await execAsync(
		`ffmpeg -y -i "${fullVideoPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v copy -c:a aac -shortest "${fullOutputPath}"`
	);

	console.log(`✅ Added silent audio track: ${outputPath}`);
}

/**
 * 合成最终广告视频
 * 
 * @param task - 生成任务
 * @param videoClips - 4个视频片段（按顺序排列）
 * @param audioSegments - 音频片段（可能少于4个，没有旁白的视频不会有对应音频）
 * @param bgm - 可选的背景音乐信息
 * @returns 最终视频信息
 */
export async function composeFinalAdVideo(
	task: GenerationTask,
	videoClips: Array<{
		clipId: string;
		clipNumber: number;
		path: string;
		duration: number;
	}>,
	audioSegments: Array<{
		segmentNumber: number;
		audioId: string;
		audioPath: string;
		duration: number;
	}>,
	bgm?: {
		bgmId: string;
		bgmPath: string;
	}
): Promise<{
	finalVideoId: string;
	finalVideoPath: string;
	totalDuration: number;
}> {
	const taskDir = `ad_final/${task.id}`;
	const fullDir = localStorage.getFullPath(taskDir);
	await mkdir(fullDir, { recursive: true });

	// 1. 为每个视频片段合并对应音频（或添加静音音轨）
	const mergedPaths: string[] = [];

	for (let i = 0; i < videoClips.length; i++) {
		const clip = videoClips[i];
		const audio = audioSegments.find(a => a.segmentNumber === clip.clipNumber);

		const timestamp = Date.now();
		const randomStr = randomBytes(4).toString('hex');
		const mergedFilename = `merged_${clip.clipNumber}_${timestamp}_${randomStr}.mp4`;
		const mergedPath = `${taskDir}/${mergedFilename}`;

		if (audio) {
			// 有音频，合并
			await mergeVideoWithAudio(clip.path, audio.audioPath, mergedPath, task.id);
		} else {
			// 没有音频，添加静音音轨（确保 concat 时编码一致）
			await addSilentAudioTrack(clip.path, mergedPath);
		}

		mergedPaths.push(mergedPath);
	}

	// 2. 重新编码所有片段以确保编码一致性
	// 关键：使用 -shortest 截断到最短流，再用 -af apad 将音频填充到与视频等长
	// 这样每个片段的音频时长 === 视频时长，concat 拼接时音视频才能对齐
	const normalizedPaths: string[] = [];
	for (let i = 0; i < mergedPaths.length; i++) {
		const inputPath = localStorage.getFullPath(mergedPaths[i]);
		const normalizedFilename = `normalized_${i + 1}_${Date.now()}.mp4`;
		const normalizedPath = `${taskDir}/${normalizedFilename}`;
		const fullNormalizedPath = localStorage.getFullPath(normalizedPath);

		// 获取该片段的视频时长
		const videoDurationMs = await getVideoDuration(mergedPaths[i]);
		const videoDurationSec = (videoDurationMs / 1000).toFixed(3);

		// 重新编码，同时确保音频流精确填充/截断到视频时长
		// -af apad: 用静音填充音频到视频时长（解决音频比视频短的问题）
		// -t: 精确截断到视频时长（解决 apad 产生无限流的问题，同时处理音频比视频长的情况）
		await execAsync(
			`ffmpeg -y -i "${inputPath}" -c:v libx264 -preset fast -crf 23 -af "apad" -c:a aac -b:a 128k -ar 44100 -ac 2 -t ${videoDurationSec} "${fullNormalizedPath}"`
		);

		normalizedPaths.push(normalizedPath);
	}

	// 3. 使用 FFmpeg concat 合并所有片段为最终视频
	const concatFilePath = `/tmp/ad_concat_${Date.now()}.txt`;
	const concatContent = normalizedPaths
		.map(p => {
			const fullPath = resolve(localStorage.getFullPath(p));
			return `file '${fullPath}'`;
		})
		.join('\n');

	const fs = await import('fs/promises');
	await fs.writeFile(concatFilePath, concatContent, 'utf-8');

	const concatFilename = `concat_${Date.now()}_${randomBytes(4).toString('hex')}.mp4`;
	const concatVideoPath = `${taskDir}/${concatFilename}`;
	const fullConcatPath = localStorage.getFullPath(concatVideoPath);

	try {
		await execAsync(
			`ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c copy "${fullConcatPath}"`
		);
	} finally {
		await fs.unlink(concatFilePath).catch(() => {});
	}

	console.log(`✅ Concatenated video created: ${concatVideoPath}`);

	// 4. 混入 BGM（如果有）
	let outputVideoPath: string;

	if (bgm) {
		const bgmFullPath = localStorage.getFullPath(bgm.bgmPath);
		const finalFilename = `final_${Date.now()}_${randomBytes(4).toString('hex')}.mp4`;
		const finalPath = `${taskDir}/${finalFilename}`;
		const fullFinalPath = localStorage.getFullPath(finalPath);

		// 获取拼接后视频的时长
		const videoDurationMs = await getVideoDuration(concatVideoPath);
		const videoDurationSec = (videoDurationMs / 1000).toFixed(3);

		// BGM 降低音量（-15dB），与原有旁白音频混合
		// -filter_complex: 将 BGM 降低音量后与视频原音轨混合
		// -t: 截断到视频时长（BGM 通常比视频长）
		await execAsync(
			`ffmpeg -y -i "${fullConcatPath}" -i "${bgmFullPath}" -filter_complex "[1:a]volume=0.15,aloop=loop=-1:size=2e+09[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 128k -t ${videoDurationSec} "${fullFinalPath}"`
		);

		console.log(`✅ BGM mixed into final video: ${finalPath}`);
		outputVideoPath = finalPath;
	} else {
		outputVideoPath = concatVideoPath;
	}

	const fullFinalPath = localStorage.getFullPath(outputVideoPath);

	// 5. 获取最终视频元数据
	const metadata = await extractVideoMetadata(fullFinalPath);
	const fileStats = await stat(fullFinalPath);

	// 6. 保存到数据库
	const [finalRecord] = await db
		.insert(adFinalVideo)
		.values({
			taskId: task.id,
			path: outputVideoPath,
			storageType: 'local',
			duration: metadata.duration,
			width: metadata.width,
			height: metadata.height,
			fileSize: Number(fileStats.size),
			clipCount: videoClips.length,
			clipIds: videoClips.map(c => c.clipId),
			audioIds: audioSegments.map(a => a.audioId),
			bgmId: bgm?.bgmId || null,
			totalGenerationTime: null
		})
		.returning();

	return {
		finalVideoId: finalRecord.id,
		finalVideoPath: outputVideoPath,
		totalDuration: metadata.duration
	};
}
