// src/lib/server/services/adBgmService.ts
/**
 * 广告BGM服务
 * 通过 Jamendo API 搜索并下载背景音乐
 * 使用 fuzzytags 参数匹配音乐风格标签
 */

import { db } from '../db';
import { adBgm, type GenerationTask, type AdCopy } from '../db/schema';
import { localStorage } from '../storage/local';
import { getJamendoClientId } from './utils/apiClients';

const JAMENDO_API_BASE = 'https://api.jamendo.com/v3.0';

interface JamendoTrack {
	id: string;
	name: string;
	duration: number;
	artist_id: string;
	artist_name: string;
	artist_idstr: string;
	album_name: string;
	album_id: string;
	license_ccurl: string;
	position: number;
	releasedate: string;
	album_image: string;
	audio: string;
	audiodownload: string;
	prourl: string;
	shorturl: string;
	shareurl: string;
	waveform: string;
	image: string;
	musicinfo?: {
		tags?: {
			genres: string[];
			instruments: string[];
			vartags: string[];
		};
	};
}

interface JamendoResponse {
	headers: {
		status: string;
		code: number;
		error_message: string;
		warnings: string;
		results_count: number;
	};
	results: JamendoTrack[];
}

/**
 * 通过 fuzzytags 搜索 Jamendo 曲目
 * fuzzytags 格式: "groove+rock" (多个标签用+连接)
 */
async function searchJamendoTracks(
	fuzzytags: string,
	limit: number = 5
): Promise<JamendoTrack[]> {
	const clientId = getJamendoClientId();

	const params = new URLSearchParams({
		client_id: clientId,
		format: 'json',
		limit: String(limit),
		fuzzytags: fuzzytags,
		include: 'musicinfo',
		audioformat: 'mp32',
		order: 'relevance',
		type: 'single albumtrack',
		vocalinstrumental: 'instrumental'
	});

	const url = `${JAMENDO_API_BASE}/tracks/?${params.toString()}`;
	console.log(`🔍 Searching Jamendo: fuzzytags="${fuzzytags}"`);

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Jamendo API error: ${response.status} ${response.statusText}`);
	}

	const data: JamendoResponse = await response.json();

	if (data.headers.code !== 0) {
		throw new Error(`Jamendo API error: ${data.headers.error_message}`);
	}

	console.log(`✅ Found ${data.results.length} tracks for fuzzytags="${fuzzytags}"`);
	return data.results;
}

/**
 * 下载 Jamendo 音频到本地
 */
async function downloadJamendoTrack(
	track: JamendoTrack,
	taskId: string
): Promise<{ path: string; fileSize: number }> {
	const audioUrl = track.audiodownload || track.audio;
	if (!audioUrl) {
		throw new Error(`No audio URL for track ${track.id}`);
	}

	console.log(`⬇️ Downloading BGM: "${track.name}" by ${track.artist_name}...`);

	const response = await fetch(audioUrl);
	if (!response.ok) {
		throw new Error(`Failed to download BGM: ${response.statusText}`);
	}

	const buffer = Buffer.from(await response.arrayBuffer());
	const localPath = `ad_bgm/${taskId}/${track.id}.mp3`;

	await localStorage.upload(buffer, localPath);

	console.log(`✅ BGM downloaded: ${localPath} (${(buffer.length / 1024).toFixed(0)}KB)`);

	return {
		path: localPath,
		fileSize: buffer.length
	};
}

/**
 * 选择最佳 BGM 曲目
 * 优先选择时长适中（15-60秒）的曲目，避免过短或过长
 */
function selectBestTrack(
	tracks: JamendoTrack[],
	targetDurationSec: number
): JamendoTrack {
	if (tracks.length === 0) {
		throw new Error('No tracks available for selection');
	}

	const scored = tracks.map(track => {
		const durationDiff = Math.abs(track.duration - targetDurationSec);
		const score = -durationDiff;
		return { track, score };
	});

	scored.sort((a, b) => b.score - a.score);
	return scored[0].track;
}

/**
 * 搜索并下载 BGM
 * 基于广告文案的 bgmTags 搜索 Jamendo，下载最匹配的曲目
 */
export async function searchAndDownloadBgm(
	task: GenerationTask,
	adCopyRecord: AdCopy,
	targetDurationSec: number
): Promise<{
	bgmId: string;
	bgmPath: string;
	trackName: string;
	artistName: string;
	duration: number;
}> {
	const bgmTags = adCopyRecord.bgmTags || ['chill', 'pop'];
	const fuzzytags = bgmTags.join('+');

	// 搜索曲目
	let tracks = await searchJamendoTracks(fuzzytags, 10);

	// 如果没有结果，用更宽松的搜索（只用第一个标签）
	if (tracks.length === 0 && bgmTags.length > 1) {
		console.log(`⚠️ No results for "${fuzzytags}", retrying with "${bgmTags[0]}"...`);
		tracks = await searchJamendoTracks(bgmTags[0], 10);
	}

	// 仍然没有结果，用通用标签
	if (tracks.length === 0) {
		console.log(`⚠️ No results, falling back to "pop+chill"...`);
		tracks = await searchJamendoTracks('pop+chill', 10);
	}

	if (tracks.length === 0) {
		throw new Error('No BGM tracks found on Jamendo');
	}

	// 选择最佳曲目
	const selectedTrack = selectBestTrack(tracks, targetDurationSec);
	console.log(`🎵 Selected BGM: "${selectedTrack.name}" by ${selectedTrack.artist_name} (${selectedTrack.duration}s)`);

	// 下载曲目
	const { path, fileSize } = await downloadJamendoTrack(selectedTrack, task.id);

	// 保存到数据库
	const [bgmRecord] = await db
		.insert(adBgm)
		.values({
			taskId: task.id,
			adCopyId: adCopyRecord.id,
			jamendoTrackId: selectedTrack.id,
			trackName: selectedTrack.name,
			artistName: selectedTrack.artist_name,
			albumName: selectedTrack.album_name || null,
			fuzzytags,
			sourceUrl: selectedTrack.audiodownload || selectedTrack.audio,
			path,
			duration: selectedTrack.duration,
			fileSize,
			license: selectedTrack.license_ccurl || null
		})
		.returning();

	return {
		bgmId: bgmRecord.id,
		bgmPath: path,
		trackName: selectedTrack.name,
		artistName: selectedTrack.artist_name,
		duration: selectedTrack.duration
	};
}
