// src/lib/server/services/ugcScript.ts
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ugcScript, type GenerationTask, type Product } from '../db/schema.js';

// 使用 Zod 定义单个脚本的 Schema
const ScriptSchema = z.object({
	title: z.string().describe('视频标题（吸引人的标题）'),
	hook: z.string().describe('前3秒钩子（引起观众注意的开场）'),
	storyline: z.string().describe('完整的故事线描述'),
	character: z.object({
		name: z.string().describe('角色名称'),
		age: z.string().describe('角色年龄段'),
		occupation: z.string().describe('角色职业'),
		personality: z.string().describe('角色性格特点'),
		emotionalArc: z.string().describe('情感变化弧线')
	}),
	keyScenes: z.array(z.string()).describe('关键场景列表，每个场景用一句话描述')
});

// 定义多个脚本的 Schema（一次生成多个）
const MultipleScriptsSchema = z.object({
	scripts: z.array(ScriptSchema).describe('生成的多个脚本列表')
});

// 从 Zod schema 推断 TypeScript 类型
export type UgcScriptResult = z.infer<typeof ScriptSchema>;
export type MultipleScriptsResult = z.infer<typeof MultipleScriptsSchema>;

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
 * 定义脚本生成的 JSON Schema（从 Zod 转换）
 * 使用 Zod v4 原生的 z.toJSONSchema() 方法
 */
const scriptsJsonSchema = z.toJSONSchema(MultipleScriptsSchema, {
	target: 'openapi-3.0',
});

/**
 * 使用 Google Gemini 生成 UGC 脚本
 */
export async function generateUgcScripts(
	task: GenerationTask,
	product: Product
): Promise<{
	scripts: UgcScriptResult[];
	usageMetadata: Record<string, unknown> | null;
	model: string;
}> {
	const videoCount = task.count;
	const targetDuration = task.targetDuration;
	const language = task.language;
	
	// 视频生成任务必须有 targetDuration
	if (!targetDuration) {
		throw new Error('Target duration is required for video generation');
	}
	
	if (videoCount < 1 || videoCount > 10) {
		throw new Error('Video count must be between 1 and 10');
	}

	if (targetDuration < 5 || targetDuration > 60) {
		throw new Error('Target duration must be between 5 and 60 seconds');
	}

	// 2. 计算实际脚本时长（预留缓冲时间）
	// 12秒视频 -> 10秒脚本（留2秒）
	// 24秒视频 -> 20秒脚本（留4秒）
	// 规则：预留约 15-20% 的时间作为缓冲
	const bufferRatio = 0.17; // 预留17%的时间
	const scriptDuration = Math.floor(targetDuration * (1 - bufferRatio));
	
	// 3. 根据目标时长确定场景数量
	// 如果时间12秒或12秒以下，场景为3个，反之为4个
	const scenesCount = targetDuration <= 12 ? 2 : 4;
	
	// 4. 构建提示词
	const languageMap: Record<string, string> = {
		zh: '中文',
		en: 'English',
		es: 'Español',
		hi: 'हिन्दी',
		ar: 'العربية',
		pt: 'Português',
		ru: 'Русский',
		ja: '日本語'
	};

	const targetLanguage = languageMap[language] || '中文';

	const prompt = `你是一位专业的UGC视频脚本创作专家。请基于以下产品信息，创作 ${videoCount} 个不同的短视频脚本。

# 产品信息

## 基本信息
- 产品名称：${product.name}
- 产品描述：${product.description}
- 产品类别：${product.category}

## 外观特征
${JSON.stringify(product.appearance, null, 2)}

## 功能特点
${JSON.stringify(product.functionality, null, 2)}

## 目标受众
${JSON.stringify(product.targetAudience, null, 2)}

## 使用场景
${JSON.stringify(product.usageScenario, null, 2)}

## 情感定位
${JSON.stringify(product.emotionalPositioning, null, 2)}

# 创作要求

## 视频参数
- 目标时长：${scriptDuration} 秒
- 语言：${targetLanguage}
- 数量：${videoCount} 个不同的脚本

## 脚本要求

1. **多样性**：每个脚本要有不同的角度和故事线
   - 可以从不同的使用场景切入
   - 可以展现不同的情感诉求
   - 可以针对不同的目标受众

2. **故事结构**：
   - 每个脚本应采用贴近真实用户视角的UGC（用户生成内容）带货风格，语言自然、富有代入感，能够引发观众共鸣和信任
   - **重要**：整体内容控制在 ${scriptDuration} 秒内，故事要完整流畅

3. **关键场景设计**：
   - 每个脚本包含 ${scenesCount} 个关键场景（根据 ${scriptDuration} 秒的时长设计）
   - 每个场景用一句话描述（30-50字）
   - 场景之间要有流畅的转场和连贯的故事线
   - 每个场景描述应包含：地点、时间、角色动作、情感、产品互动

4. **角色设计**：
   - 角色要符合目标受众特征
   - 要有清晰的情感变化弧线
   - 与产品互动要自然真实

5. **语言风格**：
   - 使用 ${targetLanguage}
   - 故事线和场景描述要生动具体
   - 符合短视频平台的观看习惯

## 创意方向参考

可以考虑以下创意角度（但不限于此）：
- 问题-解决型：展示痛点→产品解决
- 对比型：使用前后的对比
- 故事型：完整的小故事，产品自然融入
- 教程型：如何使用产品达到效果
- 情感型：通过情感共鸣建立连接
- 生活方式型：展示理想的生活状态

请为每个脚本设计不同的创意方向，确保内容多样化。`;

	// 3. 调用 Gemini API（使用结构化输出）
	const genAI = getGeminiClient();

	const result = await genAI.models.generateContent({
		model: 'gemini-3-flash-preview',
		contents: [{ text: prompt }],
		config: {
			responseMimeType: 'application/json',
			responseJsonSchema: scriptsJsonSchema
		}
	});

	const text = result.text || '{}';

	// 4. 使用 Zod 解析和验证 JSON 响应
	let scriptsData: MultipleScriptsResult;
	try {
		const rawData = JSON.parse(text);
		scriptsData = MultipleScriptsSchema.parse(rawData);
	} catch (error) {
		console.error('Failed to parse or validate Gemini response:', text);
		console.error('Validation error:', error);
		throw new Error('Failed to parse UGC scripts result');
	}

	// 5. 获取使用信息（保存所有字段，不限定结构）
	const usageMetadata = result.usageMetadata ? { ...result.usageMetadata } : null;

	return {
		scripts: scriptsData.scripts,
		usageMetadata,
		model: 'gemini-3-flash-preview'
	};
}

/**
 * 保存单个脚本到数据库
 * @param taskId - 任务 ID
 * @param scriptData - 脚本数据
 * @param usageMetadata - 使用统计（如果是批量生成，只有第一个脚本包含此数据）
 * @param model - 模型名称
 */
export async function saveUgcScript(
	taskId: string,
	scriptData: UgcScriptResult,
	usageMetadata: Record<string, unknown> | null,
	model: string
) {
	const [inserted] = await db
		.insert(ugcScript)
		.values({
			taskId,
			title: scriptData.title,
			hook: scriptData.hook,
			storyline: scriptData.storyline,
			character: scriptData.character,
			keyScenes: scriptData.keyScenes,
			provider: 'google',
			model,
			usageMetadata
		})
		.returning();

	return inserted;
}

/**
 * 生成并保存 UGC 脚本（一次性完成）
 * 
 * 注意：由于是一次 LLM 调用生成多个脚本，usageMetadata 是共享的。
 * 为了避免数据冗余，只在第一个脚本中保存 usageMetadata，
 * 其他脚本的 usageMetadata 为 null。
 */
export async function generateAndSaveUgcScripts(
	task: GenerationTask,
	product: Product
) {
	// 1. 生成脚本
	const { scripts, usageMetadata, model } = await generateUgcScripts(task, product);

	// 2. 保存所有脚本到数据库
	// 只在第一个脚本中保存 usageMetadata，其他设为 null（因为是共享的）
	const savedScripts = await Promise.all(
		scripts.map((scriptData, index) => 
			saveUgcScript(
				task.id, 
				scriptData, 
				index === 0 ? usageMetadata : null,  // 只有第一个脚本保存 usageMetadata
				model
			)
		)
	);

	return {
		scripts: savedScripts,
		usageMetadata,
		model,
		count: savedScripts.length
	};
}
