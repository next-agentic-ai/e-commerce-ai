// src/lib/server/jobs/handlers/pollVideoStatus.ts
import { updateTaskStatus } from '../../services/ugcTask.js';
import { batchUpdateVideoStatus } from '../../services/videoGeneration.js';
import type { PollVideoStatusJobData } from '../types';
import type { Job } from 'pg-boss';

/**
 * 轮询视频状态任务处理器
 */
export async function handlePollVideoStatus(
	job: Job<PollVideoStatusJobData>
): Promise<void> {
	const { videoClipIds, taskId, maxAttempts, pollInterval } = job.data;

	console.log(`[Job ${job.id}] Starting to poll video status for task ${taskId}`);

	try {
		let attempt = 0;

		while (attempt < maxAttempts) {
			attempt++;

			// 等待指定间隔
			if (attempt > 1) {
				await new Promise(resolve => setTimeout(resolve, pollInterval));
			}

			// 批量查询状态
			const statuses = await batchUpdateVideoStatus(videoClipIds);

			const completed = statuses.filter(s => s.status === 'succeeded').length;
			const failed = statuses.filter(s => s.status === 'failed').length;
			const pending = statuses.length - completed - failed;

			console.log(`[Job ${job.id}] Attempt ${attempt}/${maxAttempts}:`, {
				completed,
				failed,
				pending
			});

			// 如果全部完成（成功或失败）
			if (pending === 0) {
				if (failed === 0) {
					// 全部成功
					await updateTaskStatus(taskId, 'completed');

					console.log(`[Job ${job.id}] All videos completed successfully`);
					return;

				} else if (completed > 0) {
					// 部分成功
					await updateTaskStatus(
						taskId,
						'completed',
						`${failed} videos failed to generate`
					);

					console.log(`[Job ${job.id}] Completed with ${failed} failures`);
					return;

				} else {
					// 全部失败
					throw new Error('All videos failed to generate');
				}
			}
		}

		// 超时
		const statuses = await batchUpdateVideoStatus(videoClipIds);
		const completed = statuses.filter(s => s.status === 'succeeded').length;

		if (completed > 0) {
			// 部分完成
			await updateTaskStatus(
				taskId,
				'completed',
				'Some videos timed out'
			);

			console.log(`[Job ${job.id}] Timed out with ${completed} videos completed`);
		} else {
			// 全部超时
			throw new Error('Video generation timed out');
		}

	} catch (error) {
		console.error(`[Job ${job.id}] Poll video status failed:`, error);

		// 更新任务状态为 failed
		await updateTaskStatus(
			taskId,
			'failed',
			error instanceof Error ? error.message : 'Unknown error'
		);

		throw error;
	}
}
