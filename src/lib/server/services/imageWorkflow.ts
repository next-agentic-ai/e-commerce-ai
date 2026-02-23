// src/lib/server/services/imageWorkflow.ts
/**
 * 宣传图生成完整工作流
 * 整合产品分析 -> 图片生成
 */

import type { GenerationTask } from '../db/schema';
import { analyzeAndCreateProduct } from './productAnalysis';
import { generatePromotionalImages, type ImageGenerationResult } from './imageGeneration';
import { updateTaskStatus } from './ugcTask';
import { extractErrorMessage, logError } from './utils/errorHandler';

/**
 * 图片生成工作流状态
 */
export type ImageWorkflowStatus = 
	| 'pending'
	| 'analyzing'
	| 'generating_images'
	| 'completed'
	| 'failed';

/**
 * 图片生成工作流结果
 */
export interface ImageWorkflowResult {
	status: ImageWorkflowStatus;
	productId?: string;
	imageIds?: string[];
	generatedCount?: number;
	error?: string;
}

/**
 * 完整的宣传图生成工作流
 * 
 * @param task - 生成任务
 * @returns 工作流结果
 */
export async function executeImageGenerationWorkflow(
	task: GenerationTask
): Promise<ImageWorkflowResult> {
	try {
		// 1. 分析产品
		console.log('\n🎨 Starting promotional image generation workflow...');
		console.log('Step 1: Analyzing product...');
		
		await updateTaskStatus(task.id, 'analyzing');
		const { product } = await analyzeAndCreateProduct(task);
		console.log(`✅ Product analyzed: ${product.name}`);

		// 2. 生成宣传图
		console.log('Step 2: Generating promotional images...');
		
		await updateTaskStatus(task.id, 'generating_images');
		const images: ImageGenerationResult[] = await generatePromotionalImages(task);
		
		if (images.length === 0) {
			throw new Error('Failed to generate any images');
		}

		console.log(`✅ Generated ${images.length} promotional images`);

		// 3. 更新任务状态为完成
		await updateTaskStatus(task.id, 'completed');
		
		console.log('✅ Image generation workflow completed successfully\n');

		return {
			status: 'completed',
			productId: product.id,
			imageIds: images.map(img => img.id),
			generatedCount: images.length
		};
	} catch (error) {
		logError('Image generation workflow', error);
		
		// 更新任务状态为失败
		const errorMessage = extractErrorMessage(error);
		await updateTaskStatus(task.id, 'failed', errorMessage);

		return {
			status: 'failed',
			error: errorMessage
		};
	}
}
