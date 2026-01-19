// src/lib/server/jobs/index.ts
/**
 * 任务队列管理
 * 导出所有任务相关的功能
 */

export { getPgBoss, startPgBoss, stopPgBoss, ensurePgBossStarted } from './pgBoss';
export { registerJobHandlers, sendUgcVideoWorkflowJob, sendImageGenerationWorkflowJob } from './registry';
export { JOB_NAMES } from './types';
export type { UgcVideoWorkflowJobData, PollVideoStatusJobData, ImageGenerationWorkflowJobData } from './types';
