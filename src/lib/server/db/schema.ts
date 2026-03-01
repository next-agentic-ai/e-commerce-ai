import { pgTable, text, timestamp, integer, jsonb, uuid, pgEnum, real, index } from 'drizzle-orm/pg-core';

// ============================================================
// 用户和认证相关表
// ============================================================

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	nickname: text('nickname').notNull(),
	passwordHash: text('password_hash').notNull(),
	phoneNumber: text('phone_number').unique(),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
});

// ============================================================
// 内容生成相关枚举
// ============================================================

export const taskTypeEnum = pgEnum('task_type', ['image', 'ad_video']);
export const taskStatusEnum = pgEnum('task_status', ['pending', 'analyzing', 'scripting', 'storyboarding', 'generating_frames', 'generating_images', 'generating_videos', 'compositing', 'completed', 'failed', 'cancelled']);
export const aspectRatioEnum = pgEnum('aspect_ratio', ['9:16', '16:9', '1:1', '4:5']);
export const languageEnum = pgEnum('language', ['zh', 'en', 'es', 'hi', 'ar', 'pt', 'ru', 'ja']);
export const storageTypeEnum = pgEnum('storage_type', ['local', 'supabase', 's3', 'cloudflare', 'cdn']);
export const providerEnum = pgEnum('provider', ['google', 'openai', 'anthropic', 'runway', 'pika', 'luma', 'stability', 'bytedance']);
export const aiTaskStatusEnum = pgEnum('ai_task_status', ['queued', 'running', 'cancelled', 'succeeded', 'failed', 'expired']);

// ============================================================
// 产品管理表
// ============================================================

export const product = pgTable(
	'product',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		productImageId: uuid('product_image_id')
			.notNull()
			.unique()
			.references(() => productImage.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description'),
		category: text('category'), // 产品类别
		
		// 产品外观分析
		appearance: jsonb('appearance').$type<{
			shape: string;
			color: string[];
			material: string;
			size: string;
			designFeatures: string[];
		}>(),
		
		// 产品功能分析
		functionality: jsonb('functionality').$type<{
			mainFunction: string;
			usageMethod: string;
			uniqueSellingPoints: string[];
		}>(),
		
		// 目标受众分析
		targetAudience: jsonb('target_audience').$type<{
			ageRange: string;
			gender: string;
			occupation: string;
			lifestyle: string;
		}>(),
		
		// 使用场景分析
		usageScenario: jsonb('usage_scenario').$type<{
			primaryLocation: string;
			usageTiming: string;
			environment: string;
		}>(),
		
		// 情感定位分析
		emotionalPositioning: jsonb('emotional_positioning').$type<{
			painPoints: string[];
			benefits: string[];
			emotionalAppeal: string;
		}>(),
		
		// 产品分析的LLM信息（基于产品图片分析）
		provider: providerEnum('provider'), // 进行分析的AI供应商
		model: text('model'), // 使用的具体模型
		usageMetadata: jsonb('usage_metadata'), // 使用统计（不同provider返回的字段可能不同）
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_product_product_image_id').on(table.productImageId)
	]
);

// ============================================================
// 产品图片表
// ============================================================

export const productImage = pgTable(
	'product_image',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(), // 用户上传的文件名（不要求唯一）
		path: text('path').notNull(), // 逻辑路径：'products/user_123/image_1.png'
		storageType: storageTypeEnum('storage_type').notNull().default('local'),
		imageType: text('image_type'), // front, side, back, use_case, detail, etc.
		width: integer('width'),
		height: integer('height'),
		fileSize: integer('file_size'), // bytes
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_product_image_user_id').on(table.userId)
	]
);

// ============================================================
// 内容生成任务表（统一视频和图片生成）
// ============================================================

export const generationTask = pgTable(
	'generation_task',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		
		// 任务类型
		taskType: taskTypeEnum('task_type').notNull(), // image 或 ad_video
		
		// 输入：用户上传的产品图片（只支持一张）
		productImageId: uuid('product_image_id')
			.notNull()
			.references(() => productImage.id, { onDelete: 'cascade' }),
			
		// 生成参数
		aspectRatio: aspectRatioEnum('aspect_ratio').notNull().default('9:16'),
		language: languageEnum('language').notNull().default('zh'), // 语言（图片文案语言）
		count: integer('count').notNull().default(1), // 生成数量
		
		// 任务状态
		status: taskStatusEnum('status').notNull().default('pending'),
		errorMessage: text('error_message'),
		jobId: text('job_id'), // pg-boss 任务ID，用于跟踪后台任务
		
		// 时间戳
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
		completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_generation_task_user_id').on(table.userId),
		index('idx_generation_task_type').on(table.taskType)
	]
);

// ============================================================
// UGC脚本表
// ============================================================
// 宣传图表
// ============================================================

export const promotionalImage = pgTable(
	'promotional_image',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		
		// 图片生成提示词
		imagePrompt: text('image_prompt').notNull(),
		productReferenceImages: jsonb('product_reference_images').$type<string[]>(), // 产品参考图片ID列表
		styleKeywords: jsonb('style_keywords').$type<string[]>(),
		
		// AI生成返回的文本描述
		generatedText: text('generated_text'), // Gemini API 返回的文本部分（如果有）
		
		// 生成的图片（同步生成，直接保存到本地）
		path: text('path').notNull(), // 本地存储路径：'promotional/task_123/image_1.png'
		storageType: storageTypeEnum('storage_type').notNull().default('local'),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		fileSize: integer('file_size').notNull(), // bytes
		
		// 生成信息
		provider: providerEnum('provider').notNull(), // google, openai, stability, bytedance, etc.
		model: text('model').notNull(), // 具体模型名称
		usageMetadata: jsonb('usage_metadata'), // 使用统计（不同provider返回的字段可能不同）
		generationTime: integer('generation_time'), // 毫秒
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_promotional_image_task_id').on(table.taskId)
	]
);

// ============================================================
// 广告文案表（ad_video workflow）
// ============================================================

export const adCopy = pgTable(
	'ad_copy',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		productImageId: uuid('product_image_id')
			.notNull()
			.unique()
			.references(() => productImage.id, { onDelete: 'cascade' }),
		
		// 广告文案结构
		style: text('style').notNull(), // 文案风格，如"对比反差型"
		title: text('title').notNull(), // 广告标题
		body: text('body').notNull(), // 广告正文
		cta: text('cta').notNull(), // CTA结尾
		
		// 完整文案文本
		fullText: text('full_text').notNull(),
		
		// BGM 标签（用于 Jamendo fuzzytags 搜索）
		bgmTags: jsonb('bgm_tags').$type<string[]>(),
		
		// 生成信息
		provider: providerEnum('provider'),
		model: text('model'),
		usageMetadata: jsonb('usage_metadata'),
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ad_copy_product_image_id').on(table.productImageId)
	]
);

// ============================================================
// 广告分镜表（ad_video workflow - 4个画面描述）
// ============================================================

export const adStoryboard = pgTable(
	'ad_storyboard',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		adCopyId: uuid('ad_copy_id')
			.notNull()
			.references(() => adCopy.id, { onDelete: 'cascade' }),
		
		// 4个画面描述
		scenes: jsonb('scenes').$type<Array<{
			sceneNumber: number;
			title: string; // 画面标题，如"问题出现（环境挑战）"
			duration: number; // 画面时长（秒），2-4秒
			narration: string | null; // 字幕/旁白（可选，没有旁白时为null）
			imagePrompt: string; // 首帧图生成prompt（中文），只描述场景画面
			videoPrompt: string; // 视频生成prompt（中文），描述主体动作 + 镜头语言 + 运镜
		}>>().notNull(),
		
		// 生成信息
		provider: providerEnum('provider'),
		model: text('model'),
		usageMetadata: jsonb('usage_metadata'),
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ad_storyboard_task_id').on(table.taskId)
	]
);

// ============================================================
// 广告分镜图片表（ad_video workflow - 2x2网格图 + 切分图）
// ============================================================

export const adStoryboardImage = pgTable(
	'ad_storyboard_image',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		storyboardId: uuid('storyboard_id')
			.notNull()
			.references(() => adStoryboard.id, { onDelete: 'cascade' }),
		
		// 图片类型
		imageType: text('image_type').notNull(), // 'grid' | 'frame_1' ~ 'frame_4'
		sceneNumber: integer('scene_number'), // 1-4 for individual frames, null for grid
		
		// 图片文件
		path: text('path').notNull(),
		storageType: storageTypeEnum('storage_type').notNull().default('local'),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		fileSize: integer('file_size').notNull(),
		
		// 生成信息
		provider: providerEnum('provider'),
		model: text('model'),
		usageMetadata: jsonb('usage_metadata'),
		generationTime: integer('generation_time'),
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ad_storyboard_image_task_id').on(table.taskId),
		index('idx_ad_storyboard_image_storyboard_id').on(table.storyboardId)
	]
);

// ============================================================
// 广告视频片段表（ad_video workflow - 4个视频，每个场景一个）
// ============================================================

export const adVideoClip = pgTable(
	'ad_video_clip',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		storyboardId: uuid('storyboard_id')
			.notNull()
			.references(() => adStoryboard.id, { onDelete: 'cascade' }),
		
		// 视频序号（1-6）
		clipNumber: integer('clip_number').notNull(),
		
		// 首尾帧图片
		firstFrameImageId: uuid('first_frame_image_id')
			.references(() => adStoryboardImage.id),
		lastFrameImageId: uuid('last_frame_image_id')
			.references(() => adStoryboardImage.id),
		
		// 视频文件
		sourceVideoUrl: text('source_video_url'),
		path: text('path'),
		storageType: storageTypeEnum('storage_type').default('local'),
		duration: integer('duration'), // 秒
		width: integer('width'),
		height: integer('height'),
		fileSize: integer('file_size'),
		
		// AI 任务状态
		status: aiTaskStatusEnum('status').notNull().default('queued'),
		downloadStatus: text('download_status'),
		downloadedAt: timestamp('downloaded_at', { withTimezone: true, mode: 'date' }),
		
		// 生成信息
		provider: providerEnum('provider'),
		model: text('model'),
		operationId: text('operation_id'),
		aiPrompt: text('ai_prompt'),
		usageMetadata: jsonb('usage_metadata'),
		generationTime: integer('generation_time'),
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ad_video_clip_task_id').on(table.taskId),
		index('idx_ad_video_clip_storyboard_id').on(table.storyboardId)
	]
);

// ============================================================
// 广告音频表（ad_video workflow - TTS音频）
// ============================================================

export const adAudio = pgTable(
	'ad_audio',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		storyboardId: uuid('storyboard_id')
			.notNull()
			.references(() => adStoryboard.id, { onDelete: 'cascade' }),
		
		// 音频类型
		audioType: text('audio_type').notNull(), // 'full' | 'segment_1' ~ 'segment_6'
		segmentNumber: integer('segment_number'), // 1-6 for segments, null for full
		
		// 原始文本
		text: text('text').notNull(),
		
		// 音频文件
		path: text('path').notNull(),
		storageType: storageTypeEnum('storage_type').notNull().default('local'),
		duration: real('duration'), // 毫秒
		fileSize: integer('file_size'),
		
		// TTS时间戳信息
		wordTimestamps: jsonb('word_timestamps').$type<Array<{
			word: string;
			startTime: number;
			endTime: number;
		}>>(),
		
		// 是否经过加速处理
		isSpeedAdjusted: integer('is_speed_adjusted').notNull().default(0), // boolean: 0 or 1
		speedRatio: real('speed_ratio'), // 加速比例
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ad_audio_task_id').on(table.taskId),
		index('idx_ad_audio_storyboard_id').on(table.storyboardId)
	]
);

// ============================================================
// 广告BGM表（ad_video workflow - Jamendo背景音乐）
// ============================================================

export const adBgm = pgTable(
	'ad_bgm',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		adCopyId: uuid('ad_copy_id')
			.notNull()
			.references(() => adCopy.id, { onDelete: 'cascade' }),
		
		// Jamendo 曲目信息
		jamendoTrackId: text('jamendo_track_id').notNull(),
		trackName: text('track_name').notNull(),
		artistName: text('artist_name').notNull(),
		albumName: text('album_name'),
		
		// 搜索参数
		fuzzytags: text('fuzzytags').notNull(),
		
		// 音频文件
		sourceUrl: text('source_url').notNull(),
		path: text('path').notNull(),
		storageType: storageTypeEnum('storage_type').notNull().default('local'),
		duration: real('duration'), // 秒
		fileSize: integer('file_size'),
		
		// 许可信息
		license: text('license'),
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ad_bgm_task_id').on(table.taskId),
		index('idx_ad_bgm_ad_copy_id').on(table.adCopyId)
	]
);

// ============================================================
// 广告最终视频表（ad_video workflow - 合成视频）
// ============================================================

export const adFinalVideo = pgTable(
	'ad_final_video',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		
		// 视频文件
		path: text('path').notNull(),
		storageType: storageTypeEnum('storage_type').notNull().default('local'),
		duration: integer('duration').notNull(), // 秒
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		fileSize: integer('file_size').notNull(),
		
		// 组成信息
		clipCount: integer('clip_count').notNull(),
		clipIds: jsonb('clip_ids').$type<string[]>().notNull(),
		audioIds: jsonb('audio_ids').$type<string[]>(),
		bgmId: uuid('bgm_id').references(() => adBgm.id),
		
		// 统计信息
		totalGenerationTime: integer('total_generation_time'),
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ad_final_video_task_id').on(table.taskId)
	]
);

// ============================================================
// 任务日志表（用于调试和监控）
// ============================================================

export const taskLog = pgTable('task_log', {
	id: uuid('id').primaryKey().defaultRandom(),
	taskId: uuid('task_id')
		.notNull()
		.references(() => generationTask.id, { onDelete: 'cascade' }),
	
	step: text('step').notNull(), // analyzing, scripting, storyboarding, etc.
	status: text('status').notNull(), // started, completed, failed
	message: text('message'),
	details: jsonb('details'), // 额外的详细信息
	
	duration: integer('duration'), // 毫秒
	
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

// ============================================================
// 类型导出
// ============================================================

export type Session = typeof session.$inferSelect;
export type User = typeof user.$inferSelect;
export type Product = typeof product.$inferSelect;
export type ProductImage = typeof productImage.$inferSelect;
export type GenerationTask = typeof generationTask.$inferSelect;
export type PromotionalImage = typeof promotionalImage.$inferSelect;
export type TaskLog = typeof taskLog.$inferSelect;

export type AdCopy = typeof adCopy.$inferSelect;
export type AdStoryboard = typeof adStoryboard.$inferSelect;
export type AdStoryboardImage = typeof adStoryboardImage.$inferSelect;
export type AdVideoClip = typeof adVideoClip.$inferSelect;
export type AdAudio = typeof adAudio.$inferSelect;
export type AdBgm = typeof adBgm.$inferSelect;
export type AdFinalVideo = typeof adFinalVideo.$inferSelect;

// Insert类型（用于创建新记录）
export type NewProduct = typeof product.$inferInsert;
export type NewProductImage = typeof productImage.$inferInsert;
export type NewGenerationTask = typeof generationTask.$inferInsert;
export type NewPromotionalImage = typeof promotionalImage.$inferInsert;
export type NewTaskLog = typeof taskLog.$inferInsert;
export type NewAdCopy = typeof adCopy.$inferInsert;
export type NewAdStoryboard = typeof adStoryboard.$inferInsert;
export type NewAdStoryboardImage = typeof adStoryboardImage.$inferInsert;
export type NewAdVideoClip = typeof adVideoClip.$inferInsert;
export type NewAdAudio = typeof adAudio.$inferInsert;
export type NewAdBgm = typeof adBgm.$inferInsert;
export type NewAdFinalVideo = typeof adFinalVideo.$inferInsert;