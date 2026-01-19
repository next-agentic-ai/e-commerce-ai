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

export const taskTypeEnum = pgEnum('task_type', ['video', 'image']);
export const generationModeEnum = pgEnum('generation_mode', ['from_scratch', 'from_reference']);
export const taskStatusEnum = pgEnum('task_status', ['pending', 'analyzing', 'scripting', 'storyboarding', 'generating_frames', 'generating_videos', 'generating_images', 'compositing', 'completed', 'failed', 'cancelled']);
export const aspectRatioEnum = pgEnum('aspect_ratio', ['9:16', '16:9', '1:1', '4:5']);
export const languageEnum = pgEnum('language', ['zh', 'en', 'es', 'hi', 'ar', 'pt', 'ru', 'ja']);
export const storageTypeEnum = pgEnum('storage_type', ['local', 'supabase', 's3', 'cloudflare', 'cdn']);
export const providerEnum = pgEnum('provider', ['google', 'openai', 'anthropic', 'runway', 'pika', 'luma', 'stability', 'bytedance']);
export const frameTypeEnum = pgEnum('frame_type', ['first', 'key', 'last', 'middle']);
export const aiTaskStatusEnum = pgEnum('ai_task_status', ['queued', 'running', 'cancelled', 'succeeded', 'failed', 'expired']);

// ============================================================
// 产品管理表
// ============================================================

export const product = pgTable(
	'product',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
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
		index('idx_product_task_id').on(table.taskId)
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
		taskType: taskTypeEnum('task_type').notNull(), // video 或 image
		
		// 输入：用户上传的产品图片
		productImageIds: jsonb('product_image_ids').$type<string[]>().notNull(), // 用于分析的产品图片ID列表
		
		// 生成模式（主要用于视频）
		generationMode: generationModeEnum('generation_mode').notNull().default('from_scratch'),
		referenceVideoUrl: text('reference_video_url'), // 模式B使用（视频生成）
		
		// 生成参数
		targetDuration: integer('target_duration'), // 秒（视频生成使用）
		aspectRatio: aspectRatioEnum('aspect_ratio').notNull().default('9:16'),
		language: languageEnum('language').notNull().default('zh'), // 语言（视频配音语言/图片文案语言）
		count: integer('count').notNull().default(1), // 生成数量（视频或图片）
		
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

export const ugcScript = pgTable(
	'ugc_script',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		
		title: text('title').notNull(),
		hook: text('hook'), // 前3秒钩子
		storyline: text('storyline').notNull(),
		
		// 角色设计
		character: jsonb('character').$type<{
			name: string;
			age: string;
			occupation: string;
			personality: string;
			emotionalArc: string;
		}>(),
		
		// 关键场景列表（简化版）
		keyScenes: jsonb('key_scenes').$type<string[]>().notNull(), // 场景描述列表
		
		// 生成信息
		provider: providerEnum('provider'), // google, bytedance, runway, etc.
		model: text('model'), // 具体模型名称
		usageMetadata: jsonb('usage_metadata'), // 使用统计（不同provider返回的字段可能不同）
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ugc_script_task_id').on(table.taskId)
	]
);

// ============================================================
// 分镜表
// ============================================================

export const shotBreakdown = pgTable(
	'shot_breakdown',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		scriptId: uuid('script_id')
			.notNull()
			.references(() => ugcScript.id, { onDelete: 'cascade' }),
		
		shotNumber: integer('shot_number').notNull(),
		title: text('title'), // 镜头标题（3-5字）
		sceneReference: integer('scene_reference'), // 对应的场景编号
		
		// 镜头设计
		duration: integer('duration').notNull(), // 秒 (根据场景需要灵活设置)
		shotType: text('shot_type').notNull(), // Wide shot, Medium shot, Close-up, POV
		cameraAngle: text('camera_angle'),
		cameraMovement: text('camera_movement'), // static, pan, tilt, tracking
		
		// 详细场景描述（用于AI生成）
		timeDescription: text('time_description'), // 时间与光线描述
		locationDescription: text('location_description'), // 地点与环境描述
		action: text('action'), // 人物动作描述
		result: text('result'), // 画面结果描述
		atmosphere: text('atmosphere'), // 环境氛围描述
		
		// 产品与视觉
		productAppearance: text('product_appearance'),
		lighting: text('lighting'),
		mood: text('mood'),
		
		requiresProductInFrame: integer('requires_product_in_frame').notNull().default(0), // boolean: 0 or 1
		
		// 生成信息
		provider: providerEnum('provider'), // google, openai, anthropic, etc.
		model: text('model'), // 具体模型名称
		usageMetadata: jsonb('usage_metadata'), // 使用统计（不同provider返回的字段可能不同）
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_shot_breakdown_script_id').on(table.scriptId)
	]
);

// ============================================================
// 关键帧图片表
// ============================================================

export const keyFrameImage = pgTable(
	'key_frame_image',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		shotId: uuid('shot_id')
			.notNull()
			.references(() => shotBreakdown.id, { onDelete: 'cascade' }),
		
		// 帧类型
		frameType: frameTypeEnum('frame_type').notNull().default('first'), // first, key, last, middle
		
		// 图片生成提示词
		imagePrompt: text('image_prompt').notNull(),
		includeProduct: integer('include_product').notNull().default(0), // boolean: 0 or 1
		productReferenceImages: jsonb('product_reference_images').$type<string[]>(), // 产品参考图片ID列表
		styleKeywords: jsonb('style_keywords').$type<string[]>(),
		
		// 生成的图片（本地存储）
		path: text('path'), // 逻辑路径：'keyframes/shot_123/first_frame.png'
		storageType: storageTypeEnum('storage_type').default('local'),
		width: integer('width'),
		height: integer('height'),
		fileSize: integer('file_size'), // bytes
		
		// 生成信息
		provider: providerEnum('provider'), // google, openai, bytedance, etc.
		model: text('model'), // 具体模型名称
		usageMetadata: jsonb('usage_metadata'), // 使用统计（不同provider返回的字段可能不同）
		generationTime: integer('generation_time'), // 毫秒
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_key_frame_image_shot_id').on(table.shotId)
	]
);

// ============================================================
// 视频片段表（可代表单个或多个分镜）
// ============================================================

export const videoClip = pgTable(
	'video_clip',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		scriptId: uuid('script_id')
			.notNull()
			.references(() => ugcScript.id, { onDelete: 'cascade' }),
		
		// 关联的分镜（支持单个或多个）
		shotIds: jsonb('shot_ids').$type<string[]>().notNull(), // 包含的分镜ID列表
		
		// 图片使用（可同时使用多种方式，支持生成的或用户上传的图片）
		firstFrameImage: jsonb('first_frame_image').$type<{
			id: string;
			source: 'generated' | 'uploaded'; // generated: keyFrameImage, uploaded: productImage
		}>(), // 作为首帧的图片
		
		lastFrameImage: jsonb('last_frame_image').$type<{
			id: string;
			source: 'generated' | 'uploaded';
		}>(), // 作为末帧的图片
		
		referenceImages: jsonb('reference_images').$type<Array<{
			id: string;
			source: 'generated' | 'uploaded';
		}>>(), // 作为参考的图片（可多张）
		
		// 视频文件
		sourceVideoUrl: text('source_video_url'), // AI供应商返回的临时URL（有时效性）
		path: text('path'), // 本地存储路径：'videos/task_123/clip_1.mp4'
		storageType: storageTypeEnum('storage_type').default('local'), // 存储类型
		duration: integer('duration').notNull(), // 秒（可能是单个shot或多个shots的总和）
		width: integer('width'),
		height: integer('height'),
		fileSize: integer('file_size'), // bytes
		
		// AI 任务状态（火山引擎等AI服务商的任务状态）
		status: aiTaskStatusEnum('status').notNull().default('queued'), // queued, running, cancelled, succeeded, failed, expired
		
		// 本地转存状态（从AI服务商URL下载到本地存储）
		downloadStatus: text('download_status'), // pending, downloading, completed, failed
		downloadedAt: timestamp('downloaded_at', { withTimezone: true, mode: 'date' }), // 转存完成时间
		
		// 分镜时间映射（用于多分镜场景）
		shotTimings: jsonb('shot_timings').$type<Array<{
			shotId: string;
			startTime: number; // 在视频中的起始时间（秒）
			endTime: number;   // 在视频中的结束时间（秒）
		}>>(), // 记录每个shot在视频中的时间位置
		
		// 生成信息
		provider: providerEnum('provider'), // google, runway, pika, bytedance, etc.
		model: text('model'), // 具体模型名称
		usageMetadata: jsonb('usage_metadata'), // 使用统计（不同provider返回的字段可能不同）
		generationTime: integer('generation_time'), // 毫秒
		
		// AI生成相关
		operationId: text('operation_id'), // 供应商的操作ID（用于追踪和查询状态）
		aiPrompt: text('ai_prompt'), // 生成视频使用的提示词
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_video_clip_task_id').on(table.taskId),
		index('idx_video_clip_script_id').on(table.scriptId)
	]
);

// ============================================================
// 最终视频表
// ============================================================

export const finalVideo = pgTable(
	'final_video',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => generationTask.id, { onDelete: 'cascade' }),
		scriptId: uuid('script_id')
			.notNull()
			.references(() => ugcScript.id, { onDelete: 'cascade' }),
		
		// 视频文件
		videoUrl: text('video_url').notNull(),
		thumbnailUrl: text('thumbnail_url'),
		duration: integer('duration').notNull(),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		fileSize: integer('file_size'),
		
		// 视频组成
		clipCount: integer('clip_count').notNull(),
		clipIds: jsonb('clip_ids').$type<string[]>().notNull(), // 包含的视频片段ID列表
		
		// 后期处理
		hasAudio: integer('has_audio').default(0), // boolean: 0 or 1
		audioUrl: text('audio_url'), // 背景音乐URL
		
		// 统计信息
		totalGenerationTime: integer('total_generation_time'), // 毫秒
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_final_video_task_id').on(table.taskId),
		index('idx_final_video_script_id').on(table.scriptId)
	]
);

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
// 参考视频表（模式B使用）
// ============================================================

export const referenceVideo = pgTable(
	'reference_video',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		name: text('name').notNull(),
		path: text('path').notNull(), // 逻辑路径：'videos/user_123/ref.mp4'
		storageType: storageTypeEnum('storage_type').notNull().default('local'),
		duration: integer('duration'),
		
		// 视频分析结果
		analysisResult: jsonb('analysis_result').$type<{
			shotCount: number;
			shots: Array<{
				shotNumber: number;
				startTime: number;
				endTime: number;
				shotType: string;
				mainSubject: string;
				action: string;
				environment: string;
				style: string;
				audioDescription?: string;
			}>;
			overallStyle: {
				visualStyle: string;
				mood: string;
				pacing: string;
				colorGrading: string;
			};
			originalProduct?: {
				description: string;
				appearances: number[]; // 出现在哪些镜头
			};
		}>(),
		
		// 使用统计
		usageCount: integer('usage_count').notNull().default(0),
		
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('idx_reference_video_user_id').on(table.userId)
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
export type UgcScript = typeof ugcScript.$inferSelect;
export type ShotBreakdown = typeof shotBreakdown.$inferSelect;
export type KeyFrameImage = typeof keyFrameImage.$inferSelect;
export type VideoClip = typeof videoClip.$inferSelect;
export type FinalVideo = typeof finalVideo.$inferSelect;
export type PromotionalImage = typeof promotionalImage.$inferSelect;
export type ReferenceVideo = typeof referenceVideo.$inferSelect;
export type TaskLog = typeof taskLog.$inferSelect;

// Insert类型（用于创建新记录）
export type NewProduct = typeof product.$inferInsert;
export type NewProductImage = typeof productImage.$inferInsert;
export type NewGenerationTask = typeof generationTask.$inferInsert;
export type NewUgcScript = typeof ugcScript.$inferInsert;
export type NewShotBreakdown = typeof shotBreakdown.$inferInsert;
export type NewKeyFrameImage = typeof keyFrameImage.$inferInsert;
export type NewVideoClip = typeof videoClip.$inferInsert;
export type NewFinalVideo = typeof finalVideo.$inferInsert;
export type NewPromotionalImage = typeof promotionalImage.$inferInsert;
export type NewReferenceVideo = typeof referenceVideo.$inferInsert;
export type NewTaskLog = typeof taskLog.$inferInsert;