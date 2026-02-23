// src/lib/server/services/adStoryboardGeneration.ts
/**
 * 广告分镜生成服务
 * 基于广告文案，使用 ARK AI 生成4个连续画面描述
 * 
 * 每个画面包含6个字段：
 * - sceneNumber：画面编号
 * - title：画面标题
 * - duration：画面时长（秒），2-4秒
 * - narration（可选）：旁白/字幕
 * - imagePrompt：首帧图生成prompt（中文），只描述场景画面
 * - videoPrompt：视频生成prompt（中文），描述主体动作 + 镜头语言 + 运镜
 */

import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { db } from '../db';
import { adStoryboard, type AdCopy, type Product, type GenerationTask } from '../db/schema';
import { getArkClient } from './utils/apiClients';

const ARK_STORYBOARD_MODEL = 'doubao-seed-2-0-lite-260215';

// 单个场景结构
const SceneSchema = z.object({
	sceneNumber: z.number().describe('画面编号，1-4'),
	title: z.string().describe('画面标题，如"问题出现（环境挑战）"'),
	duration: z.number().min(2).max(4).describe('画面时长（秒），必须在2-4秒之间'),
	narration: z.string().nullable().describe('字幕/旁白文本（可选，没有旁白时为null），不是每个画面都需要旁白。纯视觉画面可以不设旁白'),
	imagePrompt: z.string().describe('首帧图生成prompt（中文）。只描述这个画面的场景、环境、人物、物品等视觉元素。不要包含动作描述和镜头语言。用于AI生成一张静态图片'),
	videoPrompt: z.string().describe('视频生成prompt（中文）。基于首帧图来生成对应秒数的视频。必须描述画面中唯一主体的动作（只能有一个主体），并包含专业的镜头语言和运镜指令')
});

// 完整分镜结构
const StoryboardSchema = z.object({
	scenes: z.array(SceneSchema).length(4).describe('4个连续画面描述，必须正好4个')
});

export type StoryboardScene = z.infer<typeof SceneSchema>;
export type StoryboardResult = z.infer<typeof StoryboardSchema>;

/**
 * 基于广告文案生成6个画面描述
 */
export async function generateStoryboard(
	task: GenerationTask,
	product: Product,
	adCopyRecord: AdCopy
): Promise<{
	storyboard: StoryboardResult;
	usageMetadata: Record<string, unknown> | null;
	model: string;
}> {
	const ark = getArkClient();

	const prompt = `你是一个专业的广告视频分镜设计师。请基于以下广告文案和产品信息，设计4个连续画面，组成一个完整的广告视频分镜。

## 产品信息
- 产品名称：${product.name}
- 产品描述：${product.description || '无'}
- 产品类别：${product.category || '无'}
- 主要功能：${product.functionality?.mainFunction || '无'}
- 使用场景：${product.usageScenario?.primaryLocation || '无'}，${product.usageScenario?.environment || '无'}
- 外观特征：${product.appearance?.shape || '无'}，颜色 ${product.appearance?.color?.join('/') || '无'}，材质 ${product.appearance?.material || '无'}

## 广告文案
风格：${adCopyRecord.style}
标题：${adCopyRecord.title}
正文：${adCopyRecord.body}
CTA：${adCopyRecord.cta}

## 要求
请基于上面的产品信息和广告文案，设计4个连续画面，组成一个完整的、有叙事逻辑的广告视频。

你可以自由决定每个画面的内容和叙事节奏，不需要遵循固定模板。根据产品特点和文案风格，选择最合适的叙事结构（例如：问题-解决、场景叙事、情感递进、悬念揭晓、对比反差等）。关键是4个画面要形成一个完整的故事弧线，最终服务于广告文案的传达目标。

产品至少要在后半段的画面中出现。

每个画面包含以下6个字段：

1. **sceneNumber**：画面编号（1-4）
2. **title**：画面标题，简短概括这个画面的阶段
3. **duration**：画面时长（秒），必须在2-4秒之间，根据画面内容合理分配
4. **narration**（可选）：旁白/字幕文本。不是每个画面都需要旁白！纯视觉冲击的画面可以不设旁白。有旁白的画面，旁白长度必须与该画面的 duration 匹配——例如2秒的画面旁白不超过6-8个字，4秒的画面旁白不超过12-16个字。旁白念完的时间不能超过画面时长。**旁白文本的最后一个字符不能是标点符号**（如句号、感叹号、问号、逗号等），必须以文字结尾。
5. **imagePrompt**：首帧图生成prompt（中文）。这个prompt用于AI生成一张静态图片作为视频的首帧。
   - 只描述场景的视觉元素：环境、人物外貌/姿态、物品、光线、色调等
   - 不要包含动作描述（动作放在videoPrompt里）
   - 不要包含镜头语言（镜头语言放在videoPrompt里）
   - 产品出现的画面中，要参考产品的外观特征来描述
   - 示例："户外露营地，傍晚时分，冷色调光线。一名年轻男性背包客蹲在帐篷旁，面前放着一个卡式炉和锅具，表情焦虑。背景是起伏的山丘和稀疏的树林。"

6. **videoPrompt**：视频生成prompt（中文）。基于首帧图来生成视频。
   - **主体动作**：描述画面中唯一主体的动作（要求只有一个主体）
   - **镜头语言**：必须包含专业的运镜指令，从以下选择合适的组合：
     - 运镜方式：推、拉、摇、移、环绕、跟随、升、降、变焦
     - 景别：远景、全景、中景、近景、特写
     - 视角：水下镜头、航拍镜头、高机位俯拍、低机位仰拍、微距摄影、以xx为前景的镜头
   - 示例："男性背包客反复按压卡式炉点火按钮，火苗忽闪忽灭。近景推镜头，从人物手部推向卡式炉特写，捕捉火苗被风吹灭的瞬间。"

## 注意
- 画面之间要有连贯性和叙事逻辑
- imagePrompt 只描述静态场景，videoPrompt 描述动态动作和镜头
- videoPrompt 中只能有一个主体在做动作
- 使用中文`;

	const response = await ark.responses.parse({
		model: ARK_STORYBOARD_MODEL,
		input: [
			{
				role: 'user',
				content: prompt
			}
		],
		text: {
			format: zodTextFormat(StoryboardSchema, "storyboard"),
		},
	});

	if (!response.output_parsed) {
		throw new Error('Failed to parse storyboard result from ARK response');
	}

	const result = response.output_parsed;

	// 去除 narration 末尾的标点符号
	for (const scene of result.scenes) {
		if (scene.narration) {
			scene.narration = scene.narration.replace(/[，。！？、；：""''…—·,.!?;:'"()\-\s]+$/, '');
			if (scene.narration === '') {
				scene.narration = null;
			}
		}
	}

	// 验证必须有4个场景
	if (result.scenes.length !== 4) {
		throw new Error(`Expected 4 scenes, got ${result.scenes.length}`);
	}

	const usageMetadata = {
		totalTokens: response.usage?.total_tokens || 0,
		inputTokens: response.usage?.input_tokens || 0,
		outputTokens: response.usage?.output_tokens || 0,
	};

	return {
		storyboard: result,
		usageMetadata,
		model: ARK_STORYBOARD_MODEL
	};
}

/**
 * 生成并保存分镜
 */
export async function generateAndSaveStoryboard(
	task: GenerationTask,
	product: Product,
	adCopyRecord: AdCopy
): Promise<{
	storyboardRecord: typeof adStoryboard.$inferSelect;
	scenes: StoryboardScene[];
}> {
	const { storyboard, usageMetadata, model } = await generateStoryboard(task, product, adCopyRecord);

	// 保存到数据库
	const [record] = await db
		.insert(adStoryboard)
		.values({
			taskId: task.id,
			adCopyId: adCopyRecord.id,
			scenes: storyboard.scenes,
			provider: 'bytedance',
			model,
			usageMetadata
		})
		.returning();

	return {
		storyboardRecord: record,
		scenes: storyboard.scenes
	};
}
