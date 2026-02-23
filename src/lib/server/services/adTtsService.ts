// src/lib/server/services/adTtsService.ts
/**
 * TTS（文本转语音）服务
 * 使用字节跳动 TTS API 生成语音，并支持按时间戳切分
 * 
 * 现在支持4个场景，其中部分场景可能没有旁白。
 * 4个视频片段对应4段音频（无旁白的片段为静音）。
 * 
 * 视频片段与场景的对应关系（1:1）：
 * 视频1: 对应场景1的旁白
 * 视频2: 对应场景2的旁白
 * 视频3: 对应场景3的旁白
 * 视频4: 对应场景4的旁白
 */

import { db } from '../db';
import { adAudio, type GenerationTask, type AdStoryboard } from '../db/schema';
import { localStorage } from '../storage/local';
import { writeFile, mkdir } from 'fs/promises';
import { randomBytes, randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TTS_API_URL = 'https://openspeech.bytedance.com/api/v1/tts';
const TTS_API_KEY = '040b830e-d8e3-4732-971c-5d1e267b342a';

/**
 * TTS 响应中的单词时间戳
 */
interface WordTimestamp {
	word: string;
	start_time: number;
	end_time: number;
}

/**
 * TTS API 响应结构
 */
interface TtsResponse {
	reqid: string;
	code: number;
	operation: string;
	message: string;
	sequence: number;
	data: string; // base64 encoded audio data
	addition: {
		description: string;
		duration: string; // 毫秒
		frontend: string; // JSON 字符串
	};
}

/**
 * 解析的前端信息
 */
interface TtsFrontend {
	words: WordTimestamp[];
	phonemes: Array<{
		phone: string;
		start_time: number;
		end_time: number;
	}>;
}

/**
 * 调用字节跳动 TTS API
 */
export async function callTtsApi(text: string): Promise<{
	audioBuffer: Buffer;
	duration: number; // 毫秒
	words: WordTimestamp[];
}> {
	const reqid = randomUUID();

	const requestBody = {
		app: {
			cluster: 'volcano_tts'
		},
		user: {
			uid: 'ad_video_workflow'
		},
		audio: {
			voice_type: 'BV001',
			encoding: 'mp3',
			speed_ratio: 1.0,
			volume_ratio: 1.0,
			pitch_ratio: 1.0,
			emotion: 'advertising',
			language: 'cn'
		},
		request: {
			reqid,
			text,
			with_frontend: "1",
        	frontend_type: "unitTson",
			operation: 'query'
		}
	};

	const response = await fetch(TTS_API_URL, {
		method: 'POST',
		headers: {
			'x-api-key': TTS_API_KEY,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(requestBody)
	});

	if (!response.ok) {
		throw new Error(`TTS API request failed: ${response.statusText}`);
	}

	const result: TtsResponse = await response.json();

	if (result.code !== 3000) {
		throw new Error(`TTS API error: ${result.message} (code: ${result.code})`);
	}

	// 解码音频数据
	const audioBuffer = Buffer.from(result.data, 'base64');

	// 解析时间戳
	const duration = parseInt(result.addition.duration, 10);
	const frontend: TtsFrontend = JSON.parse(result.addition.frontend);

	return {
		audioBuffer,
		duration,
		words: frontend.words
	};
}

/**
 * 生成全部旁白音频（一次性合成所有有旁白的场景）
 * 只合成有 narration 的场景，跳过没有旁白的场景
 */
export async function generateFullNarrationAudio(
	task: GenerationTask,
	storyboardRecord: AdStoryboard,
	scenes: Array<{ sceneNumber: number; narration: string | null }>
): Promise<{
	fullAudioPath: string;
	fullAudioDuration: number;
	fullAudioId: string;
	words: WordTimestamp[];
	sceneNarrations: Array<{
		sceneNumber: number;
		narration: string;
		wordStartIndex: number;
		wordEndIndex: number;
	}>;
	scenesWithNarration: number[]; // 有旁白的场景编号列表
}> {
	// 过滤出有旁白的场景
	const narratedScenes = scenes.filter(s => s.narration && s.narration.trim().length > 0);

	if (narratedScenes.length === 0) {
		throw new Error('No scenes have narration text for TTS generation');
	}

	// 将所有旁白合成一个文本，每句之间加一个短暂停顿标记
	const fullText = narratedScenes.map(s => s.narration!).join('……');

	console.log(`🎤 Generating TTS for ${narratedScenes.length} narrated scenes (out of ${scenes.length} total): "${fullText}"`);

	const { audioBuffer, duration, words } = await callTtsApi(fullText);

	// 保存完整音频
	const taskDir = `ad_audio/${task.id}`;
	const fullDir = localStorage.getFullPath(taskDir);
	await mkdir(fullDir, { recursive: true });

	const timestamp = Date.now();
	const randomStr = randomBytes(4).toString('hex');
	const audioFilename = `full_narration_${timestamp}_${randomStr}.mp3`;
	const audioPath = `${taskDir}/${audioFilename}`;
	const fullAudioPath = localStorage.getFullPath(audioPath);

	await writeFile(fullAudioPath, audioBuffer);

	// 保存到数据库
	const [fullRecord] = await db
		.insert(adAudio)
		.values({
			taskId: task.id,
			storyboardId: storyboardRecord.id,
			audioType: 'full',
			segmentNumber: null,
			text: fullText,
			path: audioPath,
			storageType: 'local',
			duration,
			fileSize: audioBuffer.length,
			wordTimestamps: words.map(w => ({
				word: w.word,
				startTime: w.start_time,
				endTime: w.end_time
			})),
			isSpeedAdjusted: 0
		})
		.returning();

	console.log(`✅ Full narration audio saved: ${audioPath} (${duration}ms)`);

	// 基于 "sp" 分隔符切分 words，精确对应每个场景的时间范围
	const sceneNarrations = splitWordsBySp(
		narratedScenes.map(s => ({ sceneNumber: s.sceneNumber, narration: s.narration! })),
		words
	);

	return {
		fullAudioPath: audioPath,
		fullAudioDuration: duration,
		fullAudioId: fullRecord.id,
		words,
		sceneNarrations,
		scenesWithNarration: narratedScenes.map(s => s.sceneNumber)
	};
}

/**
 * 基于 "sp" 分隔符切分 words 数组为多个段
 * 
 * TTS 在处理 "……" 分隔符时会产生 "sp" 标记，天然就是各段旁白的分界点。
 * 例如输入 "户外露营没气补能……居家停电断燃气……没气没电，照样开火……点击入手，安心备用"
 * words 中会有3个 "sp"，将文本分成4段。
 * 
 * 每段的时间范围：从该段第一个非sp word 的 start_time 到最后一个非sp word 的 end_time
 */
function splitWordsBySp(
	scenes: Array<{ sceneNumber: number; narration: string }>,
	words: WordTimestamp[]
): Array<{
	sceneNumber: number;
	narration: string;
	wordStartIndex: number;
	wordEndIndex: number;
}> {
	// 1. 按 "sp" 切分 words 为多个 segment
	const segments: Array<{ startIdx: number; endIdx: number }> = [];
	let segStart = -1;
	let segEnd = -1;

	for (let i = 0; i < words.length; i++) {
		const w = words[i].word;
		if (w === 'sp') {
			// sp 是分隔符，如果当前有段则结束
			if (segStart !== -1) {
				segments.push({ startIdx: segStart, endIdx: segEnd });
				segStart = -1;
				segEnd = -1;
			}
		} else {
			if (segStart === -1) {
				segStart = i;
			}
			segEnd = i;
		}
	}
	// 最后一段
	if (segStart !== -1) {
		segments.push({ startIdx: segStart, endIdx: segEnd });
	}

	// 2. 将 segments 与 scenes 一一对应
	if (segments.length !== scenes.length) {
		console.warn(`⚠️ SP split produced ${segments.length} segments but expected ${scenes.length} scenes, falling back to best effort`);
	}

	const results: Array<{
		sceneNumber: number;
		narration: string;
		wordStartIndex: number;
		wordEndIndex: number;
	}> = [];

	for (let i = 0; i < scenes.length; i++) {
		if (i < segments.length) {
			results.push({
				sceneNumber: scenes[i].sceneNumber,
				narration: scenes[i].narration,
				wordStartIndex: segments[i].startIdx,
				wordEndIndex: segments[i].endIdx
			});
		}
	}

	// 打印切分结果
	for (const r of results) {
		const startTime = words[r.wordStartIndex].start_time;
		const endTime = words[r.wordEndIndex].end_time;
		console.log(`   Scene ${r.sceneNumber}: words[${r.wordStartIndex}..${r.wordEndIndex}], time ${startTime.toFixed(3)}s - ${endTime.toFixed(3)}s (${(endTime - startTime).toFixed(3)}s), narration: "${r.narration}"`);
	}

	return results;
}

/**
 * 根据 sp 切分后的时间戳切分音频段
 * 
 * sceneNarrations 已经通过 splitWordsBySp 精确计算了每段的 word 索引范围和时间。
 * 直接基于每段的 start_time / end_time 用 ffmpeg 切分即可。
 * 
 * 如果某个场景没有旁白（不在 sceneNarrations 中），则该视频不生成音频段（静音处理）
 */
export async function splitAudioByScenes(
	task: GenerationTask,
	storyboardRecord: AdStoryboard,
	fullAudioPath: string,
	words: WordTimestamp[],
	sceneNarrations: Array<{
		sceneNumber: number;
		narration: string;
		wordStartIndex: number;
		wordEndIndex: number;
	}>
): Promise<Array<{
	segmentNumber: number;
	audioId: string;
	audioPath: string;
	duration: number; // 毫秒
	narration: string;
}>> {
	const results: Array<{
		segmentNumber: number;
		audioId: string;
		audioPath: string;
		duration: number;
		narration: string;
	}> = [];

	const fullPath = localStorage.getFullPath(fullAudioPath);
	const taskDir = `ad_audio/${task.id}`;

	for (const scene of sceneNarrations) {
		const startTime = words[scene.wordStartIndex].start_time;
		const endTime = words[scene.wordEndIndex].end_time;
		const durationSec = endTime - startTime;

		if (durationSec <= 0) {
			console.warn(`Skipping segment ${scene.sceneNumber}: duration is ${durationSec}s`);
			continue;
		}

		// 使用 ffmpeg 切分音频
		const timestamp = Date.now();
		const randomStr = randomBytes(4).toString('hex');
		const segFilename = `segment_${scene.sceneNumber}_${timestamp}_${randomStr}.mp3`;
		const segPath = `${taskDir}/${segFilename}`;
		const fullSegPath = localStorage.getFullPath(segPath);

		// 使用重新编码方式切分，避免 MP3 帧边界对齐导致的时间不精确
		// -ss 放在 -i 前面实现 input seeking（更快），再用 -t 精确控制时长
		await execAsync(
			`ffmpeg -y -ss ${startTime} -i "${fullPath}" -t ${durationSec} -c:a libmp3lame -q:a 2 "${fullSegPath}"`
		);

		const durationMs = Math.round(durationSec * 1000);

		// 获取文件大小
		const { stat } = await import('fs/promises');
		const fileStats = await stat(fullSegPath);

		// 保存到数据库
		const [record] = await db
			.insert(adAudio)
			.values({
				taskId: task.id,
				storyboardId: storyboardRecord.id,
				audioType: `segment_${scene.sceneNumber}`,
				segmentNumber: scene.sceneNumber,
				text: scene.narration,
				path: segPath,
				storageType: 'local',
				duration: durationMs,
				fileSize: Number(fileStats.size),
				wordTimestamps: words.slice(scene.wordStartIndex, scene.wordEndIndex + 1).map(w => ({
					word: w.word,
					startTime: w.start_time - startTime,
					endTime: w.end_time - startTime
				})),
				isSpeedAdjusted: 0
			})
			.returning();

		results.push({
			segmentNumber: scene.sceneNumber,
			audioId: record.id,
			audioPath: segPath,
			duration: durationMs,
			narration: scene.narration
		});

		console.log(`✅ Audio segment ${scene.sceneNumber} saved: ${segPath} (${durationMs}ms, ${startTime.toFixed(3)}s - ${endTime.toFixed(3)}s)`);
	}

	return results;
}

/**
 * 调整音频速度以匹配视频时长
 * 如果音频比视频长，则加速音频
 */
export async function adjustAudioSpeedIfNeeded(
	audioPath: string,
	videoDurationMs: number,
	taskId: string
): Promise<{
	adjustedPath: string;
	isAdjusted: boolean;
	speedRatio: number;
}> {
	const fullAudioPath = localStorage.getFullPath(audioPath);

	// 获取音频时长
	const { stdout } = await execAsync(
		`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fullAudioPath}"`
	);
	const audioDurationSec = parseFloat(stdout.trim());
	const audioDurationMs = audioDurationSec * 1000;

	if (audioDurationMs <= videoDurationMs) {
		// 音频不超过视频，不需要调整
		return {
			adjustedPath: audioPath,
			isAdjusted: false,
			speedRatio: 1.0
		};
	}

	// 需要加速：计算加速比
	const speedRatio = audioDurationMs / videoDurationMs;
	console.log(`⚡ Adjusting audio speed: ${audioDurationMs.toFixed(0)}ms -> ${videoDurationMs.toFixed(0)}ms (speed: ${speedRatio.toFixed(2)}x)`);

	// 生成调速后的文件
	const taskDir = `ad_audio/${taskId}`;
	const timestamp = Date.now();
	const randomStr = randomBytes(4).toString('hex');
	const adjustedFilename = `adjusted_${timestamp}_${randomStr}.mp3`;
	const adjustedPath = `${taskDir}/${adjustedFilename}`;
	const fullAdjustedPath = localStorage.getFullPath(adjustedPath);

	// atempo 的有效范围是 0.5-2.0，如果超出需要链式应用
	let atempoFilter: string;
	if (speedRatio >= 0.5 && speedRatio <= 2.0) {
		atempoFilter = `atempo=${speedRatio.toFixed(4)}`;
	} else if (speedRatio > 2.0) {
		const steps = Math.ceil(Math.log2(speedRatio));
		const stepFactor = Math.pow(speedRatio, 1 / steps);
		atempoFilter = Array(steps).fill(`atempo=${stepFactor.toFixed(4)}`).join(',');
	} else {
		atempoFilter = `atempo=${speedRatio.toFixed(4)}`;
	}

	await execAsync(
		`ffmpeg -y -i "${fullAudioPath}" -filter:a "${atempoFilter}" "${fullAdjustedPath}"`
	);

	return {
		adjustedPath,
		isAdjusted: true,
		speedRatio
	};
}
