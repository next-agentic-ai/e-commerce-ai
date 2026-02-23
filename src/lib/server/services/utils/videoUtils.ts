// src/lib/server/services/utils/videoUtils.ts
/**
 * 视频处理工具
 * 封装 FFmpeg 常用操作
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { localStorage } from '../../storage/local';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

/**
 * 视频元数据
 */
export interface VideoMetadata {
	duration: number; // 秒
	width: number;
	height: number;
	fps: number;
	aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
	fileSize: number; // 字节
}

/**
 * 检查 FFmpeg 是否可用
 */
export async function checkFFmpeg(): Promise<void> {
	try {
		await execAsync('ffmpeg -version');
	} catch (error) {
		throw new Error('FFmpeg is not installed or not in PATH. Please install FFmpeg first.');
	}
}

/**
 * 从视频文件提取元数据
 * 
 * @param filePath - 视频文件的完整路径
 * @returns 视频元数据
 */
export async function extractVideoMetadata(filePath: string): Promise<VideoMetadata> {
	try {
		// 使用ffprobe获取视频信息和文件大小
		const { stdout } = await execAsync(
			`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration -show_entries format=size -of json "${filePath}"`
		);
		
		const data = JSON.parse(stdout);
		const stream = data.streams[0];
		
		if (!stream) {
			throw new Error('无法获取视频流信息');
		}
		
		const width = stream.width;
		const height = stream.height;
		const duration = parseFloat(stream.duration);
		
		// 解析帧率 (如 "30/1" -> 30)
		const [num, den] = stream.r_frame_rate.split('/').map(Number);
		const fps = num / den;
		
		// 获取文件大小
		const fileSize = data.format?.size ? parseInt(data.format.size) : 0;
		
		// 计算宽高比并匹配最接近的标准比例
		const ratio = width / height;
		let aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
		
		if (Math.abs(ratio - 9/16) < 0.1) {
			aspectRatio = '9:16';
		} else if (Math.abs(ratio - 16/9) < 0.1) {
			aspectRatio = '16:9';
		} else if (Math.abs(ratio - 1) < 0.1) {
			aspectRatio = '1:1';
		} else if (Math.abs(ratio - 4/5) < 0.1) {
			aspectRatio = '4:5';
		} else {
			// 默认根据横竖屏判断
			aspectRatio = width > height ? '16:9' : '9:16';
		}
		
		return {
			duration: Math.round(duration),
			width,
			height,
			fps: Math.round(fps),
			aspectRatio,
			fileSize
		};
	} catch (error) {
		console.error('Failed to extract video metadata:', error);
		throw new Error('无法提取视频元数据，请确保视频文件有效');
	}
}

/**
 * 提取视频帧并保存为图片
 * 
 * @param videoPath - 视频存储路径（相对路径）
 * @param timestamp - 时间戳（秒）
 * @param outputPath - 输出图片路径（相对路径）
 */
export async function extractFrame(
	videoPath: string,
	timestamp: number,
	outputPath: string
): Promise<void> {
	const fullInputPath = localStorage.getFullPath(videoPath);
	const fullOutputPath = localStorage.getFullPath(outputPath);
	
	// 确保输出目录存在
	const outputDir = dirname(fullOutputPath);
	if (!existsSync(outputDir)) {
		await mkdir(outputDir, { recursive: true });
	}
	
	// 使用 FFmpeg 提取帧（-y 参数自动覆盖已存在的文件）
	await execAsync(
		`ffmpeg -y -ss ${timestamp} -i "${fullInputPath}" -vframes 1 -q:v 2 "${fullOutputPath}"`
	);
}

/**
 * 从原视频中提取指定时间段的片段
 * 
 * @param videoPath - 原视频路径（相对路径）
 * @param startTime - 开始时间（秒）
 * @param duration - 持续时间（秒）
 * @param outputPath - 输出路径（相对路径）
 */
export async function extractVideoSegment(
	videoPath: string,
	startTime: number,
	duration: number,
	outputPath: string
): Promise<void> {
	const fullInputPath = localStorage.getFullPath(videoPath);
	const fullOutputPath = localStorage.getFullPath(outputPath);
	
	// 确保输出目录存在
	const outputDir = dirname(fullOutputPath);
	await mkdir(outputDir, { recursive: true });
	
	// 使用 FFmpeg 提取片段（-y 参数自动覆盖已存在的文件）
	await execAsync(
		`ffmpeg -y -ss ${startTime} -i "${fullInputPath}" -t ${duration} -c copy "${fullOutputPath}"`
	);
}

/**
 * 使用 FFmpeg 调整视频速度以匹配目标时长
 * 
 * @param inputPath - 输入视频路径（相对路径）
 * @param targetDuration - 目标时长（秒）
 * @param outputPath - 输出视频路径（相对路径）
 */
export async function adjustVideoSpeed(
	inputPath: string,
	targetDuration: number,
	outputPath: string
): Promise<void> {
	const fullInputPath = localStorage.getFullPath(inputPath);
	const fullOutputPath = localStorage.getFullPath(outputPath);
	
	// 1. 获取原始视频时长
	const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fullInputPath}"`;
	const { stdout } = await execAsync(durationCmd);
	const originalDuration = parseFloat(stdout.trim());
	
	// 2. 计算速度调整系数
	const speedFactor = originalDuration / targetDuration;
	
	console.log(`Adjusting video speed: ${originalDuration.toFixed(2)}s -> ${targetDuration.toFixed(2)}s (speed: ${speedFactor.toFixed(2)}x)`);
	
	// 3. 构建视频和音频滤镜
	let videoFilter = `setpts=${(1 / speedFactor).toFixed(4)}*PTS`;
	let audioFilter = '';
	
	// atempo 的有效范围是 0.5-2.0，如果超出需要链式应用
	if (speedFactor >= 0.5 && speedFactor <= 2.0) {
		audioFilter = `atempo=${speedFactor.toFixed(4)}`;
	} else if (speedFactor > 2.0) {
		const steps = Math.ceil(Math.log2(speedFactor));
		const stepFactor = Math.pow(speedFactor, 1 / steps);
		audioFilter = Array(steps).fill(`atempo=${stepFactor.toFixed(4)}`).join(',');
	} else {
		const steps = Math.ceil(Math.log2(1 / speedFactor));
		const stepFactor = Math.pow(speedFactor, 1 / steps);
		audioFilter = Array(steps).fill(`atempo=${stepFactor.toFixed(4)}`).join(',');
	}
	
	// 4. 检查是否有音频轨道
	const checkAudioCmd = `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${fullInputPath}"`;
	let hasAudio = false;
	try {
		const { stdout: audioCheck } = await execAsync(checkAudioCmd);
		hasAudio = audioCheck.trim() === 'audio';
	} catch {
		hasAudio = false;
	}
	
	// 5. 执行速度调整（-y 参数自动覆盖已存在的文件）
	let ffmpegCmd;
	if (hasAudio) {
		ffmpegCmd = `ffmpeg -y -i "${fullInputPath}" -filter_complex "[0:v]${videoFilter}[v];[0:a]${audioFilter}[a]" -map "[v]" -map "[a]" -c:v libx264 -preset fast -c:a aac "${fullOutputPath}"`;
	} else {
		ffmpegCmd = `ffmpeg -y -i "${fullInputPath}" -filter:v "${videoFilter}" -c:v libx264 -preset fast -an "${fullOutputPath}"`;
	}
	
	await execAsync(ffmpegCmd);
	console.log(`Video speed adjusted and saved to: ${outputPath}`);
}

/**
 * 使用 FFmpeg 合并视频片段
 * 
 * @param videoSegments - 视频片段列表，每项包含 path 和 duration
 * @param outputPath - 输出视频路径（相对路径）
 */
export async function mergeVideoSegments(
	videoSegments: Array<{ path: string; duration: number }>,
	outputPath: string
): Promise<void> {
	if (videoSegments.length === 0) {
		throw new Error('No video segments to merge');
	}
	
	// 如果只有一个片段，直接复制
	if (videoSegments.length === 1) {
		const fullInputPath = localStorage.getFullPath(videoSegments[0].path);
		const fullOutputPath = localStorage.getFullPath(outputPath);
		await execAsync(`cp "${fullInputPath}" "${fullOutputPath}"`);
		return;
	}
	
	// 创建 FFmpeg concat 输入文件
	const concatFilePath = `/tmp/concat_${Date.now()}.txt`;
	const concatContent = videoSegments
		.map(seg => {
			const fullPath = localStorage.getFullPath(seg.path);
			return `file '${fullPath}'`;
		})
		.join('\n');
	
	const fs = await import('fs/promises');
	await fs.writeFile(concatFilePath, concatContent, 'utf-8');
	
	try {
		const fullOutputPath = localStorage.getFullPath(outputPath);
		
		// 使用 FFmpeg concat demuxer 合并视频（-y 参数自动覆盖已存在的文件）
		await execAsync(
			`ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c copy "${fullOutputPath}"`
		);
		
		console.log(`Merged ${videoSegments.length} video segments to ${outputPath}`);
	} finally {
		// 清理临时文件
		await fs.unlink(concatFilePath);
	}
}

/**
 * 使用 FFmpeg 检测场景切换
 * 
 * @param videoPath - 视频路径（相对路径）
 * @param threshold - 场景切换阈值（0-1，默认0.4）
 * @returns 场景切换的时间戳列表
 */
export async function detectSceneChanges(
	videoPath: string,
	threshold: number = 0.4
): Promise<number[]> {
	const fullPath = localStorage.getFullPath(videoPath);
	const tempFile = `/tmp/scenes_${Date.now()}.txt`;
	
	try {
		// 使用 FFmpeg 的 scene detection filter
		await execAsync(
			`ffmpeg -i "${fullPath}" -filter_complex "select='gt(scene,${threshold})',showinfo" -f null - 2>&1 | grep "Parsed_showinfo" | grep "pts_time" > "${tempFile}"`
		);
		
		// 读取输出文件并解析时间戳
		const { readFile } = await import('fs/promises');
		const content = await readFile(tempFile, 'utf-8');
		const timestamps: number[] = [0]; // 第一个镜头从0开始
		
		// 解析每一行，提取 pts_time
		const lines = content.split('\n').filter(line => line.includes('pts_time'));
		for (const line of lines) {
			const match = line.match(/pts_time:(\d+\.?\d*)/);
			if (match) {
				timestamps.push(parseFloat(match[1]));
			}
		}
		
		return timestamps;
	} finally {
		// 清理临时文件
		if (existsSync(tempFile)) {
			await execAsync(`rm "${tempFile}"`);
		}
	}
}
