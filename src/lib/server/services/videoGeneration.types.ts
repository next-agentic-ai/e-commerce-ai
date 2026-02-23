// src/lib/server/services/videoGeneration.types.ts

/**
 * 火山引擎视频生成相关的类型定义
 */

/**
 * 视频任务状态（数据库枚举 = API 返回）
 * queued: 排队中
 * running: 任务运行中
 * cancelled: 取消任务
 * succeeded: 任务成功
 * failed: 任务失败
 * expired: 任务超时
 */
export type VideoTaskStatus = 'queued' | 'running' | 'cancelled' | 'succeeded' | 'failed' | 'expired';

/**
 * 视频比例类型
 * - 16:9: 横屏（宽屏）
 * - 4:3: 横屏（传统）
 * - 1:1: 正方形
 * - 3:4: 竖屏
 * - 9:16: 竖屏（短视频）
 * - 21:9: 超宽屏
 * - adaptive: 根据输入自动选择最合适的宽高比
 */
export type VideoAspectRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9' | 'adaptive';

/**
 * 内容项类型 - 文本
 */
export interface TextContent {
	type: 'text';
	text: string;
}

/**
 * 内容项类型 - 图片
 */
export interface ImageContent {
	type: 'image_url';
	image_url: {
		url: string; // URL 或 data:image/png;base64,xxx
	};
	role?: 'first_frame' | 'last_frame' | 'reference_image';
}

/**
 * 内容项联合类型
 */
export type ContentItem = TextContent | ImageContent;

/**
 * 视频生成请求参数（火山引擎格式）
 */
export interface VideoGenerationRequest {
	model: string;
	content: ContentItem[];
	ratio: VideoAspectRatio;
	duration: number; // -1=自动决定长度, 4-6秒=指定时长
	resolution?: '480p' | '720p' | '1080p'; // 视频分辨率，Seedance 1.0 pro & pro-fast 默认1080p，1080p不支持参考图场景
	watermark?: boolean;
	generate_audio?: boolean;
	draft?: boolean; // Seedance 1.5 pro 样片模式（480p预览，消耗token更少）
}

/**
 * 视频生成错误信息
 */
export interface VideoGenerationError {
	code: string;
	message: string;
}

/**
 * 视频内容信息
 */
export interface VideoContent {
	video_url: string;
}

/**
 * Token 使用信息
 */
export interface VideoUsage {
	completion_tokens: number;
	total_tokens: number;
}

/**
 * 创建视频任务的响应（只返回任务ID）
 */
export interface VideoGenerationResponse {
	id: string;  // 火山引擎返回的任务ID
}

/**
 * 查询视频任务状态的响应
 */
export interface VideoStatusResponse {
	id: string;
	model: string;
	status: VideoTaskStatus;
	content: VideoContent;  // 必需字段
	usage: VideoUsage;  // 必需字段
	created_at: number;
	updated_at: number;
	seed: number;  // 必需字段
	resolution: string;  // 必需字段，如 "720p"
	ratio: string;  // 必需字段，如 "16:9"
	duration: number;  // 必需字段
	framespersecond?: number;
	service_tier: string;  // 必需字段
	execution_expires_after: number;  // 必需字段
	generate_audio: boolean;  // 必需字段
	draft: boolean;  // 必需字段
	draft_task_id?: string;  // 必需字段
	error?: VideoGenerationError;  // 失败时返回
}

/**
 * 批量创建任务结果
 */
export interface BatchCreateResult {
	shotId: string;
	videoClipId: string;
	taskId: string;
	operationId: string;
}

/**
 * 批量更新状态结果
 */
export interface BatchUpdateResult {
	videoClipId: string;
	status: VideoTaskStatus;
	videoUrl?: string;
	error?: string;
}

/**
 * 视频状态更新结果
 */
export interface VideoStatusResult {
	status: VideoTaskStatus;
	videoUrl?: string;
	updated: boolean;
}

/**
 * 创建视频任务结果
 */
export interface CreateVideoTaskResult {
	videoClipId: string;
	taskId: string;
	operationId: string;
}
