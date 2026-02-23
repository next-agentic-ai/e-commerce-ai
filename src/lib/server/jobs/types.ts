// src/lib/server/jobs/types.ts
import { z } from 'zod';

/**
 * 任务名称
 */
export const JOB_NAMES = {
	IMAGE_GENERATION_WORKFLOW: 'image-generation-workflow',
	AD_VIDEO_WORKFLOW: 'ad-video-workflow'
} as const;

/**
 * 图片生成工作流任务数据
 */
export const ImageGenerationWorkflowJobSchema = z.object({
	taskId: z.uuid()
});

export type ImageGenerationWorkflowJobData = z.infer<typeof ImageGenerationWorkflowJobSchema>;

/**
 * 广告视频工作流任务数据
 */
export const AdVideoWorkflowJobSchema = z.object({
	taskId: z.uuid()
});

export type AdVideoWorkflowJobData = z.infer<typeof AdVideoWorkflowJobSchema>;
