// src/lib/server/services/adCopyGeneration.ts
/**
 * 广告文案生成服务
 * 基于产品分析结果，使用 ARK AI 生成一条广告文案
 * adCopy 与 productImage 1:1 绑定
 */

import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { db } from '../db';
import { adCopy, type Product, type GenerationTask, type AdCopy } from '../db/schema';
import { getArkClient } from './utils/apiClients';

const ARK_AD_COPY_MODEL = 'doubao-seed-2-0-lite-260215';

// 广告文案结构
const AdCopySchema = z.object({
	style: z.string().describe('文案风格类型，如"对比反差型"、"场景叙事型"、"功能展示型"'),
	title: z.string().describe('广告标题，简短有力'),
	body: z.string().describe('广告正文，包含痛点描述和产品优势'),
	cta: z.string().describe('结尾CTA（行动号召），引导用户行动'),
	bgmTags: z.array(z.string()).min(2).max(4).describe('背景音乐风格标签（英文），2-4个标签，用于搜索匹配的BGM。从以下类别中选择：流派类(pop, rock, electronic, hiphop, jazz, classical, ambient, folk, rnb, reggae, latin, country, blues, metal, punk, soul, funk)、情绪类(energetic, chill, happy, sad, epic, romantic, dark, uplifting, dreamy, aggressive, peaceful, melancholic, groovy, funky)、场景类(cinematic, corporate, workout, travel, nature, party, lounge, meditation)')
});

export type AdCopyResult = z.infer<typeof AdCopySchema>;

/**
 * 基于产品分析生成广告文案
 */
export async function generateAdCopy(
	product: Product
): Promise<{
	adCopy: AdCopyResult;
	usageMetadata: Record<string, unknown> | null;
	model: string;
}> {
	const ark = getArkClient();

	const prompt = `你是一个顶级广告创意总监。请基于以下产品信息，生成一条有冲击力的广告文案。

## 产品信息
- 产品名称：${product.name}
- 产品描述：${product.description || '无'}
- 产品类别：${product.category || '无'}
- 主要功能：${product.functionality?.mainFunction || '无'}
- 使用方法：${product.functionality?.usageMethod || '无'}
- 独特卖点：${product.functionality?.uniqueSellingPoints?.join('、') || '无'}
- 目标受众：${product.targetAudience?.lifestyle || '无'}（${product.targetAudience?.ageRange || '无'}，${product.targetAudience?.gender || '不限'}）
- 使用场景：${product.usageScenario?.primaryLocation || '无'}，${product.usageScenario?.environment || '无'}
- 痛点：${product.emotionalPositioning?.painPoints?.join('、') || '无'}
- 利益点：${product.emotionalPositioning?.benefits?.join('、') || '无'}
- 情感诉求：${product.emotionalPositioning?.emotionalAppeal || '无'}

## 要求
生成的广告文案需要包含以下结构：
1. style：文案风格类型（如"对比反差型"、"场景叙事型"、"功能展示型"等）
2. title：广告标题，简短有力，能抓住眼球
3. body：广告正文，描述痛点和产品优势，语言生动有感染力
4. cta：结尾CTA，引导用户采取行动
5. bgmTags：背景音乐风格标签（英文），2-4个标签，用于搜索匹配的背景音乐。根据广告的情感基调和节奏选择合适的音乐风格标签。例如：活力运动类广告用 ["energetic", "rock"]，温馨家居类广告用 ["chill", "acoustic"]，科技感广告用 ["electronic", "cinematic"]，户外探险类广告用 ["epic", "folk"]。

文案要有张力，有节奏感，能打动目标受众。参考以下示例的结构和语感：

---
标题：当气罐罢工时，它还在烧
正文：低温没火力？风大点不着？液体燃料炉不吃这一套。稳定燃烧、承重大、燃料易得，不是为了"精致"，而是为了一定能用。
CTA：别把吃饭交给运气，升级真正的野外炉具。
---

请用中文生成。`;

	const response = await ark.responses.parse({
		model: ARK_AD_COPY_MODEL,
		input: [
			{
				role: 'user',
				content: prompt
			}
		],
		text: {
			format: zodTextFormat(AdCopySchema, "ad_copy"),
		},
	});

	if (!response.output_parsed) {
		throw new Error('Failed to parse ad copy result from ARK response');
	}

	const result = response.output_parsed;

	const usageMetadata = {
		totalTokens: response.usage?.total_tokens || 0,
		inputTokens: response.usage?.input_tokens || 0,
		outputTokens: response.usage?.output_tokens || 0,
	};

	return {
		adCopy: result,
		usageMetadata,
		model: ARK_AD_COPY_MODEL
	};
}

/**
 * 生成并保存广告文案
 * adCopy 与 productImage 1:1 绑定
 */
export async function generateAndSaveAdCopy(
	productImageId: string,
	product: Product
): Promise<{
	adCopyRecord: AdCopy;
	adCopyResult: AdCopyResult;
}> {
	const { adCopy: result, usageMetadata, model } = await generateAdCopy(product);

	// 组装完整文案文本
	const fullText = `【${result.style}】

标题：${result.title}

正文：
${result.body}

结尾 CTA：
${result.cta}`;

	// 保存到数据库
	const [record] = await db
		.insert(adCopy)
		.values({
			productImageId,
			style: result.style,
			title: result.title,
			body: result.body,
			cta: result.cta,
			fullText,
			bgmTags: result.bgmTags,
			provider: 'bytedance',
			model,
			usageMetadata
		})
		.returning();

	return {
		adCopyRecord: record,
		adCopyResult: result
	};
}
