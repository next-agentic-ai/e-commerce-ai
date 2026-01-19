// src/lib/server/services/imageGeneration.ts
/**
 * 宣传图生成服务
 * 使用 Google Gemini 图片生成 API 创建产品宣传图
 */

import { GoogleGenAI } from '@google/genai';
import { db } from '../db/index.js';
import { promotionalImage, product, productImage, type GenerationTask, type Product } from '../db/schema.js';
import { localStorage } from '../storage/local.js';
import { eq, inArray } from 'drizzle-orm';
import { readFile, writeFile, mkdir } from 'fs/promises';

const IMAGE_MODEL = 'gemini-3-pro-image-preview';

/**
 * 图片生成结果
 */
export interface ImageGenerationResult {
	id: string;
	path: string;
	width: number;
	height: number;
	fileSize: number;
	generatedText?: string;
}

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
 * 将产品图片转换为文件格式（用于上传）
 */
async function getProductImageFiles(imageIds: string[]): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
	if (imageIds.length === 0) {
		return [];
	}

	const images = await db.query.productImage.findMany({
		where: inArray(productImage.id, imageIds),
		columns: {
			path: true
		}
	});

	const imageFiles = await Promise.all(
		images.map(async (img) => {
			const fullPath = localStorage.getFullPath(img.path);
			const buffer = await readFile(fullPath);
			
			const ext = img.path.split('.').pop()?.toLowerCase();
			const mimeType = ext === 'png' ? 'image/png' :
			                 ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
			                 ext === 'webp' ? 'image/webp' :
			                 'image/jpeg';
			
			return {
				inlineData: {
					mimeType,
					data: buffer.toString('base64')
				}
			};
		})
	);

	return imageFiles;
}

/**
 * 生成宣传图提示词
 */
async function generateImagePrompt(
	task: GenerationTask,
	product: Product
): Promise<string> {
	const language = task.language || 'zh';
	
	// 根据语言生成不同的提示词
	const languageMap: Record<string, string> = {
		'zh': '中文',
		'en': 'English',
		'es': 'Español',
		'hi': 'हिन्दी',
		'ar': 'العربية',
		'pt': 'Português',
		'ru': 'Русский',
		'ja': '日本語'
	};

	const targetLanguage = languageMap[language] || '中文';
	
	let prompt = `为${product.name}创建一张专业的产品宣传图。\n\n`;
	
	// 产品基本信息
	if (product.description) {
		prompt += `产品描述：${product.description}\n`;
	}
	
	if (product.category) {
		prompt += `产品类别：${product.category}\n`;
	}
	
	// 产品外观和设计特点
	if (product.appearance?.designFeatures && product.appearance.designFeatures.length > 0) {
		prompt += `设计特点：${product.appearance.designFeatures.join('、')}\n`;
	}
	
	// 产品功能
	if (product.functionality) {
		if (product.functionality.mainFunction) {
			prompt += `主要功能：${product.functionality.mainFunction}\n`;
		}
		if (product.functionality.uniqueSellingPoints && product.functionality.uniqueSellingPoints.length > 0) {
			prompt += `独特卖点：${product.functionality.uniqueSellingPoints.join('、')}\n`;
		}
	}
	
	// 目标受众
	if (product.targetAudience) {
		const audienceDetails: string[] = [];
		if (product.targetAudience.ageRange) {
			audienceDetails.push(`年龄：${product.targetAudience.ageRange}`);
		}
		if (product.targetAudience.lifestyle) {
			audienceDetails.push(`生活方式：${product.targetAudience.lifestyle}`);
		}
		if (audienceDetails.length > 0) {
			prompt += `目标受众：${audienceDetails.join('，')}\n`;
		}
	}
	
	// 使用场景
	if (product.usageScenario) {
		const scenarioDetails: string[] = [];
		if (product.usageScenario.primaryLocation) {
			scenarioDetails.push(product.usageScenario.primaryLocation);
		}
		if (product.usageScenario.environment) {
			scenarioDetails.push(product.usageScenario.environment);
		}
		if (scenarioDetails.length > 0) {
			prompt += `使用场景：${scenarioDetails.join('，')}\n`;
		}
	}
	
	// 情感定位
	if (product.emotionalPositioning?.emotionalAppeal) {
		prompt += `情感诉求：${product.emotionalPositioning.emotionalAppeal}\n`;
	}
	
	prompt += `\n生成要求：
- 使用${targetLanguage}生成图片中的文字和文案
- 高质量、现代化设计
- 引人注目且专业
- 产品应该是视觉焦点
- 包含吸引人的营销文案
- 突出产品的独特卖点
- 符合目标受众的审美和需求
- 适合社交媒体和广告投放`;

	return prompt;
}

/**
 * 保存生成的图片到本地存储
 */
async function saveGeneratedImage(
	taskId: string,
	imageBuffer: Buffer,
	index: number
): Promise<{ path: string; width: number; height: number; fileSize: number }> {
	// 创建存储目录
	const taskDir = `promotional/${taskId}`;
	const fullDir = localStorage.getFullPath(taskDir);
	await mkdir(fullDir, { recursive: true });

	// 生成文件名
	const filename = `image_${index + 1}.png`;
	const imagePath = `${taskDir}/${filename}`;
	const fullPath = localStorage.getFullPath(imagePath);

	// 保存图片
	await writeFile(fullPath, imageBuffer);

	// 获取图片信息
	const fileSize = imageBuffer.length;
	
	// TODO: 实际获取图片尺寸（需要图片处理库）
	// 暂时使用固定值，基于 1:1 比例
	const width = 1024;
	const height = 1024;

	return {
		path: imagePath,
		width,
		height,
		fileSize
	};
}

/**
 * 使用 Gemini 生成单张宣传图
 */
async function generateSingleImage(
	task: GenerationTask,
	product: Product,
	index: number = 0
): Promise<ImageGenerationResult> {
	const ai = getGeminiClient();
	const startTime = Date.now();

	try {
		// 生成提示词
		const prompt = await generateImagePrompt(task, product);
		console.log(`📝 Generated prompt for image ${index + 1}:`, prompt);

		// 获取产品参考图片
		const productImages = await getProductImageFiles(task.productImageIds || []);
		console.log(`📷 Loaded ${productImages.length} product reference images`);

		// 构建 contents（包含提示词和产品图片）
		const contents = [
			{
				role: 'user',
				parts: [
					{ text: prompt },
					...productImages
				]
			}
		];

		// 调用 Gemini API 生成图片
		console.log(`🎨 Generating image ${index + 1} with Gemini...`);
		const response = await ai.models.generateContent({
			model: IMAGE_MODEL,
			contents,
			config: {
				imageConfig: {
					aspectRatio: task.aspectRatio,
					imageSize: '1K'
				},
				responseModalities: ['Image']
			}
		});

		// 验证响应结构
		if (!response.candidates || response.candidates.length === 0) {
			throw new Error('No candidates returned from Gemini API');
		}

		let generatedText: string | undefined;
		let imageBuffer: Buffer | null = null;

		const candidate = response.candidates[0];
		if (!candidate?.content?.parts) {
			throw new Error('Invalid response structure from Gemini API');
		}

		// 处理返回结果
		for (const part of candidate.content.parts) {
			if (part.text) {
				generatedText = part.text;
				console.log(`📄 Generated text for image ${index + 1}:`, part.text);
			} else if (part.inlineData) {
				const imageData = part.inlineData.data;
				if (!imageData) {
					console.warn(`⚠️ Empty image data received for image ${index + 1}`);
					continue;
				}
				imageBuffer = Buffer.from(imageData, 'base64');
				console.log(`🖼️ Received image ${index + 1} data (${imageBuffer.length} bytes)`);
			}
		}

		if (!imageBuffer) {
			throw new Error('No image data received from Gemini API');
		}

		// 保存图片到本地
		const savedImage = await saveGeneratedImage(task.id, imageBuffer, index);
		console.log(`💾 Saved image ${index + 1} to:`, savedImage.path);

		const generationTime = Date.now() - startTime;

		// 保存到数据库
		const [dbRecord] = await db
			.insert(promotionalImage)
			.values({
				taskId: task.id,
				imagePrompt: prompt,
				generatedText,
				productReferenceImages: task.productImageIds || [],
				path: savedImage.path,
				storageType: 'local',
				width: savedImage.width,
				height: savedImage.height,
				fileSize: savedImage.fileSize,
				provider: 'google',
				model: IMAGE_MODEL,
				usageMetadata: response.usageMetadata,
				generationTime
			})
			.returning();

		console.log(`✅ Image ${index + 1} generation completed in ${generationTime}ms`);

		return {
			id: dbRecord.id,
			path: savedImage.path,
			width: savedImage.width,
			height: savedImage.height,
			fileSize: savedImage.fileSize,
			generatedText
		};
	} catch (error) {
		console.error(`❌ Error generating image ${index + 1}:`, error);
		throw error;
	}
}

/**
 * 为任务生成所有宣传图
 */
export async function generatePromotionalImages(
	task: GenerationTask
): Promise<ImageGenerationResult[]> {
	console.log(`\n🎨 Starting promotional image generation for task ${task.id}`);
	console.log(`📊 Configuration:`, {
		count: task.count,
		aspectRatio: task.aspectRatio,
		language: task.language,
		productImages: task.productImageIds?.length || 0
	});

	// 获取产品信息（必须存在）
	const existingProduct = await db.query.product.findFirst({
		where: eq(product.taskId, task.id)
	});

	if (!existingProduct) {
		throw new Error('Product information not found for task');
	}

	console.log(`📦 Product: ${existingProduct.name}`);

	// 生成多张图片
	const count = task.count || 1;
	const results: ImageGenerationResult[] = [];

	for (let i = 0; i < count; i++) {
		try {
			const result = await generateSingleImage(task, existingProduct, i);
			results.push(result);
		} catch (error) {
			console.error(`Failed to generate image ${i + 1}/${count}:`, error);
			// 继续生成下一张，不中断整个流程
		}
	}

	console.log(`\n✅ Image generation completed: ${results.length}/${count} images generated`);

	return results;
}

/**
 * 获取任务的所有宣传图
 */
export async function getPromotionalImagesByTaskId(
	taskId: string
): Promise<ImageGenerationResult[]> {
	const images = await db.query.promotionalImage.findMany({
		where: eq(promotionalImage.taskId, taskId)
	});

	return images.map(img => ({
		id: img.id,
		path: img.path,
		width: img.width,
		height: img.height,
		fileSize: img.fileSize,
		generatedText: img.generatedText || undefined
	}));
}
