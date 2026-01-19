// src/lib/server/services/productAnalysis.ts
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { db } from '../db/index.js';
import { product, productImage, type GenerationTask } from '../db/schema.js';
import { localStorage } from '../storage/local.js';
import { inArray } from 'drizzle-orm';
import { readFile } from 'fs/promises';

// 使用 Zod 定义产品分析结果的 Schema
const ProductAnalysisSchema = z.object({
	name: z.string().describe('产品名称'),
	description: z.string().describe('产品简短描述（1-2句话）'),
	category: z.string().describe('产品类别'),
	appearance: z.object({
		shape: z.string().describe('产品形状描述'),
		color: z.array(z.string()).describe('主要颜色列表'),
		material: z.string().describe('材质描述'),
		size: z.string().describe('尺寸/大小描述'),
		designFeatures: z.array(z.string()).describe('设计特点列表')
	}),
	functionality: z.object({
		mainFunction: z.string().describe('主要功能描述'),
		usageMethod: z.string().describe('使用方法描述'),
		uniqueSellingPoints: z.array(z.string()).describe('独特卖点列表')
	}),
	targetAudience: z.object({
		ageRange: z.string().describe('目标年龄段（如：18-35岁）'),
		gender: z.string().describe('目标性别（如：女性/男性/不限）'),
		occupation: z.string().describe('目标职业群体描述'),
		lifestyle: z.string().describe('目标生活方式描述')
	}),
	usageScenario: z.object({
		primaryLocation: z.string().describe('主要使用地点'),
		usageTiming: z.string().describe('使用时机'),
		environment: z.string().describe('使用环境描述')
	}),
	emotionalPositioning: z.object({
		painPoints: z.array(z.string()).describe('痛点列表'),
		benefits: z.array(z.string()).describe('利益点列表'),
		emotionalAppeal: z.string().describe('情感诉求描述')
	})
});

// 从 Zod schema 推断 TypeScript 类型
export type ProductAnalysisResult = z.infer<typeof ProductAnalysisSchema>;

/**
 * 初始化 Google Gemini 客户端
 */
function getGeminiClient() {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error('GEMINI_API_KEY environment variable is not set');
	}
	return new GoogleGenAI({ apiKey });
}

/**
 * 将图片转换为 base64
 */
async function imageToBase64(imagePath: string): Promise<{ data: string; mimeType: string }> {
	// 从本地存储获取完整路径
	const fullPath = localStorage.getFullPath(imagePath);
	const buffer = await readFile(fullPath);
	
	// 根据文件扩展名确定 MIME 类型
	const ext = imagePath.split('.').pop()?.toLowerCase();
	const mimeType = ext === 'png' ? 'image/png' : 
	                 ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 
	                 ext === 'webp' ? 'image/webp' : 
	                 'image/jpeg';
	
	return {
		data: buffer.toString('base64'),
		mimeType
	};
}

/**
 * 定义产品分析的 JSON Schema（从 Zod 转换）
 * 使用 Zod v4 原生的 z.toJSONSchema() 方法
 */
const productAnalysisSchema = z.toJSONSchema(ProductAnalysisSchema, {
	target: 'openapi-3.0',
});

/**
 * 使用 Google Gemini 分析产品图片（使用结构化输出 + Zod）
 */
export async function analyzeProductImages(
	task: GenerationTask
): Promise<{
	analysis: ProductAnalysisResult;
	usageMetadata: Record<string, unknown> | null;
	model: string;
}> {
	const imageIds = task.productImageIds;
	
	if (!imageIds || imageIds.length === 0) {
		throw new Error('At least one image is required for product analysis');
	}

	// 1. 获取图片信息
	const images = await db
		.select()
		.from(productImage)
		.where(inArray(productImage.id, imageIds));

	if (images.length === 0) {
		throw new Error('No images found');
	}

	// 2. 转换图片为 base64
	const imageParts = await Promise.all(
		images.map(async (img) => {
			const { data, mimeType } = await imageToBase64(img.path);
			return {
				inlineData: {
					data,
					mimeType
				}
			};
		})
	);

	// 3. 构建分析提示词（简化版，因为结构化输出会保证格式）
	const prompt = `请仔细分析这${images.length}张产品图片，提供详细的产品分析：

分析要求：
1. name：产品名称
2. description：产品简短描述（1-2句话）
3. category：产品类别
4. appearance：形状、颜色、材质、尺寸、设计特点
5. functionality：主要功能、使用方法、独特卖点
6. targetAudience：年龄段、性别、职业、生活方式
7. usageScenario：地点、时机、环境
8. emotionalPositioning：痛点、利益点、情感诉求

请根据图片内容提供准确、详细的分析结果。`;


	// 4. 调用 Gemini API（使用结构化输出）
	const genAI = getGeminiClient();

	// 构建 contents 参数：文本 + 图片
	const contentParts = [
		{ text: prompt },
		...imageParts
	];

	const result = await genAI.models.generateContent({
		model: 'gemini-3-flash-preview',
		contents: contentParts,
		config: {
			responseMimeType: 'application/json',
			responseJsonSchema: productAnalysisSchema
		}
	});

	const text = result.text || '{}';

	// 5. 使用 Zod 解析和验证 JSON 响应
	let analysis: ProductAnalysisResult;
	try {
		const rawData = JSON.parse(text);
		analysis = ProductAnalysisSchema.parse(rawData); // Zod 验证
	} catch (error) {
		console.error('Failed to parse or validate Gemini response:', text);
		console.error('Validation error:', error);
		throw new Error('Failed to parse product analysis result');
	}

	// 6. 获取使用信息（保存所有字段，不限定结构）
	const usageMetadata = result.usageMetadata ? { ...result.usageMetadata } : null;

	return {
		analysis,
		usageMetadata,
		model: 'gemini-3-flash-preview'
	};
}

/**
 * 创建产品记录（包含分析结果）
 */
export async function createProductFromAnalysis(
	task: GenerationTask,
	analysisResult: ProductAnalysisResult,
	usageMetadata: Record<string, unknown> | null,
	model: string
) {
	const [inserted] = await db
		.insert(product)
		.values({
			taskId: task.id,
			name: analysisResult.name,
			description: analysisResult.description,
			category: analysisResult.category,
			appearance: analysisResult.appearance,
			functionality: analysisResult.functionality,
			targetAudience: analysisResult.targetAudience,
			usageScenario: analysisResult.usageScenario,
			emotionalPositioning: analysisResult.emotionalPositioning,
			provider: 'google',
			model,
			usageMetadata
		})
		.returning();

	return inserted;
}

/**
 * 分析并创建产品（一步到位）
 */
export async function analyzeAndCreateProduct(task: GenerationTask) {
	// 1. 分析产品
	const { analysis, usageMetadata, model } = await analyzeProductImages(task);

	// 2. 创建产品记录
	const productRecord = await createProductFromAnalysis(task, analysis, usageMetadata, model);

	return {
		product: productRecord,
		analysis,
		usageMetadata,
		model
	};
}
