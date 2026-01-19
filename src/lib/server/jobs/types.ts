// src/lib/server/jobs/types.ts
import { z } from 'zod';

/**
 * 任务名称
 */
export const JOB_NAMES = {
	UGC_VIDEO_WORKFLOW: 'ugc-video-workflow',
	POLL_VIDEO_STATUS: 'poll-video-status',
	IMAGE_GENERATION_WORKFLOW: 'image-generation-workflow'
} as const;

/**
 * UGC视频工作流任务数据
 */
export const UgcVideoWorkflowJobSchema = z.object({
	taskId: z.uuid(),
	generateAudio: z.boolean().default(true)
});

export type UgcVideoWorkflowJobData = z.infer<typeof UgcVideoWorkflowJobSchema>;

/**
 * 轮询视频状态任务数据
 */
export const PollVideoStatusJobSchema = z.object({
	videoClipIds: z.array(z.uuid()),
	taskId: z.uuid(),
	maxAttempts: z.number().default(60),
	pollInterval: z.number().default(10000)
});

export type PollVideoStatusJobData = z.infer<typeof PollVideoStatusJobSchema>;

/**
 * 图片生成工作流任务数据
 */
export const ImageGenerationWorkflowJobSchema = z.object({
	taskId: z.uuid()
});

export type ImageGenerationWorkflowJobData = z.infer<typeof ImageGenerationWorkflowJobSchema>;
