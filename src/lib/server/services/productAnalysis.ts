// src/lib/server/services/productAnalysis.ts
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { db } from '../db';
import { product, productImage, type GenerationTask } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getArkClient } from './utils/apiClients';
import { imageToBase64WithMime } from './utils/imageUtils';

/**
 * ARK 产品分析模型
 */
const ARK_PRODUCT_ANALYSIS_MODEL = 'doubao-seed-2-0-lite-260215';

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
 * 使用 ARK AI 分析产品图片（使用结构化输出 + Zod）
 */
export async function analyzeProductImages(
	task: GenerationTask
): Promise<{
	analysis: ProductAnalysisResult;
	usageMetadata: Record<string, unknown> | null;
	model: string;
}> {
	const imageId = task.productImageId;
	
	if (!imageId) {
		throw new Error('Product image ID is required for product analysis');
	}

	// 1. 获取图片信息
	const image = await db.query.productImage.findFirst({
		where: eq(productImage.id, imageId)
	});

	if (!image) {
		throw new Error('Product image not found');
	}

	// 2. 转换图片为 base64
	const imageBase64List = [await imageToBase64WithMime(image.path)];

	// 3. 构建分析提示词
	const prompt = `请仔细分析这张产品图片，提供详细的产品分析：

分析要求：
1. name：产品名称
2. description：产品简短描述（1-2句话）
3. category：产品类别
4. appearance：包含形状、颜色（数组）、材质、尺寸、设计特点（数组）
5. functionality：包含主要功能、使用方法、独特卖点（数组）
6. targetAudience：包含年龄段、性别、职业、生活方式
7. usageScenario：包含主要使用地点、使用时机、使用环境
8. emotionalPositioning：包含痛点（数组）、利益点（数组）、情感诉求

请根据图片内容提供准确、详细的分析结果。`;

	// 4. 调用 ARK API（使用结构化输出）
	const ark = getArkClient();

	// 构建消息内容：文本 + 多张图片
	const contentParts = [
		{
			type: 'input_text' as const,
			text: prompt
		},
		...imageBase64List.map(base64 => ({
			type: 'input_image' as const,
			detail: 'auto' as const,
			image_url: base64
		}))
	];

	const response = await ark.responses.parse({
		model: ARK_PRODUCT_ANALYSIS_MODEL,
		input: [
			{
				role: 'user',
				content: contentParts
			}
		],
		text: {
			format: zodTextFormat(ProductAnalysisSchema, "product_analysis"),
		},
	});

	console.log('ARK Product Analysis Response:', response);
	
	// 5. 解析响应
	if (!response.output_parsed) {
		throw new Error('Failed to parse product analysis result from ARK response');
	}
	
	const analysis = response.output_parsed;

	// 6. 构建使用信息
	const usageMetadata = {
		totalTokens: response.usage?.total_tokens || 0,
		inputTokens: response.usage?.input_tokens || 0,
		outputTokens: response.usage?.output_tokens || 0,
	};

	return {
		analysis,
		usageMetadata,
		model: ARK_PRODUCT_ANALYSIS_MODEL
	};
}

/**
 * 创建产品记录（包含分析结果）
 * product 与 productImage 1:1 绑定，一张图片代表一个产品
 */
export async function createProductFromAnalysis(
	productImageId: string,
	analysisResult: ProductAnalysisResult,
	usageMetadata: Record<string, unknown> | null,
	model: string
) {
	const [inserted] = await db
		.insert(product)
		.values({
			productImageId,
			name: analysisResult.name,
			description: analysisResult.description,
			category: analysisResult.category,
			appearance: analysisResult.appearance,
			functionality: analysisResult.functionality,
			targetAudience: analysisResult.targetAudience,
			usageScenario: analysisResult.usageScenario,
			emotionalPositioning: analysisResult.emotionalPositioning,
			provider: 'bytedance',
			model,
			usageMetadata
		})
		.returning();

	return inserted;
}

/**
 * 分析并创建产品（一步到位）
 * 使用 task.productImageId 作为产品图片ID（一张图片代表一个产品）
 */
export async function analyzeAndCreateProduct(task: GenerationTask) {
	const productImageId = task.productImageId;
	if (!productImageId) {
		throw new Error('No product image ID found in task');
	}

	// 1. 分析产品
	const { analysis, usageMetadata, model } = await analyzeProductImages(task);

	// 2. 创建产品记录（绑定到 productImage）
	const productRecord = await createProductFromAnalysis(productImageId, analysis, usageMetadata, model);

	return {
		product: productRecord,
		analysis,
		usageMetadata,
		model
	};
}
