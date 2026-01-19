// src/lib/server/services/shotBreakdown.ts
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { db } from '../db/index.js';
import { shotBreakdown, type UgcScript, type Product } from '../db/schema.js';

// 使用 Zod 定义单个分镜的 Schema
const ShotBreakdownSchema = z.object({
	shotNumber: z.number().describe('分镜编号（从1开始）'),
	title: z.string().describe('镜头标题（3-5个字概括核心内容或情绪），例如："产品特写"、"清晨使用"、"效果展示"'),
	sceneReference: z.number().describe('对应的场景编号（从1开始，对应keyScenes数组索引+1）'),
	duration: z.number().min(2).max(6).describe('分镜时长（秒，范围2-6秒）'),
	
	// 镜头设计
	shotType: z.string().describe('镜头类型：Wide shot(远景), Medium shot(中景), Close-up(特写), Extreme close-up(大特写), POV(主观视角)'),
	cameraAngle: z.string().describe('机位角度：Eye level(平视), High angle(俯视), Low angle(仰视), Dutch angle(倾斜), Bird\'s eye(鸟瞰)'),
	cameraMovement: z.string().describe('镜头运动：Static(静止), Pan(摇镜), Tilt(俯仰), Zoom in(推镜), Zoom out(拉镜), Tracking(跟踪), Dolly(移动)'),
	
	// 详细场景描述（用于AI生成）
	timeDescription: z.string().describe('时间与光线描述（≥20字）：具体时间+详细光线描述，例如："清晨7点·柔和的晨光透过白色窗帘洒入室内，在地板上形成温暖的光影"'),
	locationDescription: z.string().describe('地点与环境描述（≥30字）：完整场景描述+空间布局+环境细节，例如："现代公寓卧室·简约白色装修，床头柜上摆放绿植，墙面挂着抽象画，整体氛围温馨舒适"'),
	
	// 动作与结果
	action: z.string().describe('人物动作描述（≥25字）：详细描述角色的具体动作+肢体细节+表情状态，例如："年轻女性坐在床边，双手轻柔地将护肤品涂抹在脸颊，动作优雅放松，脸上带着满足的微笑"'),
	result: z.string().describe('画面结果描述（≥20字）：动作的视觉结果+细节变化+情绪呈现，例如："皮肤吸收产品后呈现健康光泽，女性轻抚脸颊感受肤质改善，表情从专注转为愉悦"'),
	
	// 氛围与产品
	atmosphere: z.string().describe('环境氛围描述（≥25字）：光线质感+色调+整体氛围+情绪感受，例如："温暖柔和的色调·以米白和浅粉为主，柔光营造放松氛围，背景传来轻柔的晨间音乐，整体感觉宁静治愈"'),
	productAppearance: z.string().describe('产品呈现方式（≥15字）：产品在画面中的位置+展示角度+视觉重点，例如："产品瓶身占据画面中心，45度角展示，品牌logo清晰可见，瓶身质感在柔光下呈现高级感"。如果该镜头不含产品，填写"无产品"'),
	
	// 视觉风格
	lighting: z.string().describe('光线类型：Natural light(自然光), Soft light(柔光), Hard light(硬光), Backlight(逆光), Golden hour(黄金时段), Studio light(影棚光)'),
	mood: z.string().describe('画面情绪基调：Warm(温暖), Cool(冷静), Energetic(活力), Calm(平静), Dreamy(梦幻), Fresh(清新), Luxurious(奢华)'),
	
	requiresProductInFrame: z.boolean().describe('是否需要产品出现在画面中')
});

// 定义多个分镜的 Schema
const MultipleShotsSchema = z.object({
	shots: z.array(ShotBreakdownSchema).describe('生成的分镜列表')
});

// 从 Zod schema 推断 TypeScript 类型
export type ShotBreakdownResult = z.infer<typeof ShotBreakdownSchema>;
export type MultipleShotsResult = z.infer<typeof MultipleShotsSchema>;

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
 * 定义分镜生成的 JSON Schema（从 Zod 转换）
 * 使用 Zod v4 原生的 z.toJSONSchema() 方法
 */
const shotsJsonSchema = z.toJSONSchema(MultipleShotsSchema, {
	target: 'openapi-3.0',
});

/**
 * 使用 Google Gemini 生成分镜
 */
export async function generateShotBreakdowns(
	script: UgcScript,
	product: Product,
	targetDuration: number // 目标总时长（秒）
): Promise<{
	shots: ShotBreakdownResult[];
	usageMetadata: Record<string, unknown> | null;
	model: string;
}> {
	// 1. 构建提示词
	const prompt = `你是一位专业的广告分镜师和视觉导演。请基于以下UGC视频脚本，创作详细的分镜脚本（Shot Breakdown）。

**【重要】总时长要求：所有分镜时长之和必须等于 ${targetDuration} 秒（误差±1秒内）**

# 脚本信息

## 标题
${script.title}

## 前3秒钩子
${script.hook}

## 故事线
${script.storyline}

## 角色设定
${JSON.stringify(script.character, null, 2)}

## 关键场景列表
${JSON.stringify(script.keyScenes, null, 2)}

# 产品信息

## 产品名称
${product.name}

## 产品描述
${product.description}

## 外观特征
${JSON.stringify(product.appearance, null, 2)}

## 功能特点
${JSON.stringify(product.functionality, null, 2)}

# 分镜创作要求

## 核心原则
1. **广告导向**：每个镜头都要服务于产品展示或情感营造
2. **视觉冲击**：前3秒必须抓住眼球，建立视觉钩子
3. **产品展示**：自然融入产品，突出卖点和使用场景
4. **节奏控制**：通过镜头类型和时长控制观看节奏
5. **描述详尽**：所有描述字段要足够详细，为后续AI视频生成提供充分信息

## 分镜设计细则

### 1. 镜头标题（title）
- 用3-5个字概括镜头核心内容或情绪
- 例如："晨光唤醒"、"产品特写"、"使用展示"、"效果对比"、"满意微笑"

### 2. 镜头类型选择（shotType）
- **Wide shot (远景)**：建立场景环境，展示空间氛围（3-5秒）
- **Medium shot (中景)**：展示角色上半身和产品互动（2-4秒）
- **Close-up (特写)**：聚焦产品细节或面部表情（2-3秒）
- **Extreme close-up (大特写)**：突出产品质感、材质等微观细节（1-3秒）
- **POV (主观视角)**：让观众代入使用体验（2-4秒）

### 3. 机位角度（cameraAngle）
- **Eye level (平视)**：最自然，适合日常使用场景
- **High angle (俯视)**：展示产品全貌或桌面场景
- **Low angle (仰视)**：营造产品的品质感和重要性
- **Dutch angle (倾斜)**：创造动感和活力
- **Bird's eye (鸟瞰)**：展示产品摆放或使用环境

### 4. 镜头运动（cameraMovement）
- **Static (静止)**：稳定、聚焦，适合产品特写和细节展示
- **Pan (摇镜)**：水平扫过场景，展示环境或多个产品
- **Tilt (俯仰)**：垂直移动，展示产品从上到下或从下到上
- **Zoom in (推镜)**：聚焦重点，引导注意力到产品或细节
- **Zoom out (拉镜)**：从细节到全景，展示使用情境
- **Tracking (跟踪)**：跟随角色移动，展示使用过程
- **Dolly (移动)**：摄影机整体移动，营造沉浸感和空间感

### 5. 详细描述要求（重要！）

这些描述将直接用于AI视频生成，必须详尽具体：

#### **时间描述（timeDescription）≥20字**
- 包含：具体时间 + 详细光线描述 + 光影效果
- ✓ 好例子："清晨7点·柔和的晨光透过白色窗帘洒入室内，在木质地板上形成温暖的几何光影，整体呈现淡金色调"
- ✗ 差例子："早晨"

#### **地点描述（locationDescription）≥30字**
- 包含：场景类型 + 空间布局 + 装修风格 + 家具陈设 + 色彩基调 + 氛围感受
- ✓ 好例子："现代简约公寓卧室·纯白色墙面，原木色地板，床头柜上摆放小型绿植和护肤品，背景墙挂着抽象线条画，整体氛围温馨舒适，充满生活气息"
- ✗ 差例子："卧室"

#### **动作描述（action）≥25字**
- 包含：角色特征 + 具体动作 + 肢体细节 + 表情状态 + 产品互动
- ✓ 好例子："25岁年轻女性坐在床边，双手轻柔地将乳白色护肤霜涂抹在脸颊，指尖以打圈方式按摩，动作优雅放松，脸上带着享受的微笑，眼神专注"
- ✗ 差例子："女生在用护肤品"

#### **结果描述（result）≥20字**
- 包含：视觉变化 + 产品效果 + 角色反应 + 情绪转变
- ✓ 好例子："护肤品迅速被肌肤吸收，皮肤呈现健康水润光泽，女性轻抚脸颊感受柔滑肤质，表情从专注转为满意和愉悦，嘴角上扬"
- ✗ 差例子："皮肤变好了"

#### **氛围描述（atmosphere）≥25字**
- 包含：整体色调 + 光线质感 + 色彩搭配 + 声音环境 + 情绪氛围
- ✓ 好例子："温暖柔和的色调·以米白、浅粉、淡金为主，柔光营造放松治愈氛围，背景传来轻柔的晨间音乐或鸟鸣声，整体感觉宁静美好，充满希望感"
- ✗ 差例子："温馨"

#### **产品呈现（productAppearance）≥15字（如无产品填"无产品"）**
- 包含：产品位置 + 展示角度 + 视觉重点 + 品牌元素 + 质感细节
- ✓ 好例子："白色瓶身产品占据画面右侧中心位置，45度角展示，品牌logo清晰可见，瓶身在柔光下呈现珍珠般光泽，背景虚化突出产品"
- ✗ 差例子："产品在画面里"

### 6. 分镜数量和时长估算

**【关键要求】总时长必须等于 ${targetDuration} 秒（允许±1秒误差）**

#### **分镜总数**
- 根据关键场景的内容和节奏自由决定分镜数量
- 每个场景可以有1个或多个分镜
- **重要**：分镜数量不限，但所有分镜时长之和必须等于 ${targetDuration} 秒

#### **单个镜头时长（2-6秒范围）**
根据镜头功能估算：

1. **建立镜头（Wide shot）**：3-6秒
   - 需要时间建立场景氛围和空间感
   
2. **产品特写（Close-up/Extreme close-up）**：2-4秒
   - 产品首次出现：3-4秒（要有足够展示时间）
   - 产品细节展示：2-3秒
   
3. **使用场景（Medium shot）**：3-6秒
   - 展示产品使用过程需要足够时间
   
4. **效果展示**：2-4秒
   - 根据效果的明显程度调整
   
5. **过渡镜头**：2-3秒
   - 场景转换的衔接镜头

6. **结尾镜头（Call to action）**：2-3秒
   - 品牌展示或行动号召

**时长分配策略**：
- 根据每个场景的内容需要分配合适的时长
- 为每个关键场景自由分配镜头数量和时长
- 确保所有镜头时长之和 = ${targetDuration} 秒（±1秒）
- 可以有更多短镜头（2-3秒）来营造快节奏
- 也可以有较少长镜头（4-6秒）来营造沉浸感

**估算原则**：
- 信息量越大，时长越长
- 产品相关镜头不要太短（至少2-3秒）
- 单个镜头不超过6秒
- **最重要**：所有分镜的 duration 字段相加必须等于 ${targetDuration} 秒

### 7. 产品出现策略

- **不是每个镜头都必须有产品**
- **建立镜头**（第1-2个）可以不含产品，先营造氛围和痛点
- **产品首次出现**要有仪式感，通常在第2-3个镜头
- **产品特写镜头**要展示核心卖点和设计细节
- **使用场景镜头**展示产品与角色的自然互动
- **requiresProductInFrame = true** 的镜头：确保产品清晰可见且占据合理比例
- **requiresProductInFrame = false** 的镜头：聚焦环境、角色情绪、使用效果等

### 8. 场景编号规则

- **sceneReference** 字段从1开始，对应 keyScenes 数组的索引+1
- 例如：keyScenes[0] → sceneReference = 1
- 一个场景可以包含多个连续镜头
- 确保每个场景都至少有1个镜头

## 输出要求

请为脚本中的每个关键场景创作分镜，确保：

1. ✅ 镜头编号连续（shotNumber从1开始）
2. ✅ 每个镜头都有3-5字的标题（title）
3. ✅ 每个镜头都标注对应的场景编号（sceneReference，从1开始）
4. ✅ 镜头类型多样化，避免单调重复
5. ✅ 所有描述性字段都要详细完整，达到最低字数要求
6. ✅ 时长估算合理，**所有镜头时长之和必须等于 ${targetDuration} 秒（±1秒误差内）**
7. ✅ 产品出现的镜头要突出卖点
8. ✅ 整体节奏流畅，有张有弛

**【最终检查】**：
- 计算所有镜头的 duration 字段之和
- 确保总和 = ${targetDuration} 秒（允许 ${targetDuration-1} 到 ${targetDuration+1} 秒）
- 如果不符合，调整个别镜头的时长使其达标

**记住**：这些详细描述将直接用于AI视频生成，描述越具体，生成效果越好！

请开始创作分镜脚本。`;

	// 2. 调用 Gemini API（使用结构化输出）
	const genAI = getGeminiClient();

	const result = await genAI.models.generateContent({
		model: 'gemini-3-flash-preview',
		contents: [{ text: prompt }],
		config: {
			responseMimeType: 'application/json',
			responseJsonSchema: shotsJsonSchema
		}
	});

	const text = result.text || '{}';

	// 3. 使用 Zod 解析和验证 JSON 响应
	let shotsData: MultipleShotsResult;
	try {
		const rawData = JSON.parse(text);
		shotsData = MultipleShotsSchema.parse(rawData);
	} catch (error) {
		console.error('Failed to parse or validate Gemini response:', text);
		console.error('Validation error:', error);
		throw new Error('Failed to parse shot breakdown result');
	}

	// 4. 获取使用信息（保存所有字段，不限定结构）
	const usageMetadata = result.usageMetadata ? { ...result.usageMetadata } : null;

	return {
		shots: shotsData.shots,
		usageMetadata,
		model: 'gemini-3-flash-preview'
	};
}

/**
 * 保存单个分镜到数据库
 * 
 * @param scriptId - 脚本 ID
 * @param shotData - 分镜数据
 * @param usageMetadata - 使用统计（如果是批量生成，只有第一个分镜包含此数据）
 * @param model - 模型名称
 */
export async function saveShotBreakdown(
	scriptId: string,
	shotData: ShotBreakdownResult,
	usageMetadata: Record<string, unknown> | null,
	model: string
) {
	const [inserted] = await db
		.insert(shotBreakdown)
		.values({
			scriptId,
			shotNumber: shotData.shotNumber,
			title: shotData.title,
			sceneReference: shotData.sceneReference,
			duration: shotData.duration,
			shotType: shotData.shotType,
			cameraAngle: shotData.cameraAngle,
			cameraMovement: shotData.cameraMovement,
			// 保存详细描述字段
			timeDescription: shotData.timeDescription,
			locationDescription: shotData.locationDescription,
			action: shotData.action,
			result: shotData.result,
			atmosphere: shotData.atmosphere,
			productAppearance: shotData.productAppearance,
			lighting: shotData.lighting,
			mood: shotData.mood,
			requiresProductInFrame: shotData.requiresProductInFrame ? 1 : 0,
			provider: 'google',
			model,
			usageMetadata
		})
		.returning();

	return inserted;
}

/**
 * 生成并保存分镜（一次性完成）
 * 
 * 注意：由于是一次 LLM 调用生成多个分镜，usageMetadata 是共享的。
 * 为了避免数据冗余，只在第一个分镜中保存 usageMetadata，
 * 其他分镜的 usageMetadata 为 null。
 */
export async function generateAndSaveShotBreakdowns(
	script: UgcScript,
	product: Product,
	targetDuration: number // 目标总时长（秒）
) {
	// 1. 生成分镜
	const { shots, usageMetadata, model } = await generateShotBreakdowns(script, product, targetDuration);

	// 2. 验证总时长
	const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
	const durationDiff = Math.abs(totalDuration - targetDuration);
	
	if (durationDiff > 1) {
		console.warn(`Warning: Total shot duration (${totalDuration}s) differs from target (${targetDuration}s) by ${durationDiff}s`);
	}

	// 3. 保存所有分镜到数据库
	// 3. 保存所有分镜到数据库
	// 只在第一个分镜中保存 usageMetadata，其他设为 null（因为是共享的）
	const savedShots = await Promise.all(
		shots.map((shotData, index) => 
			saveShotBreakdown(
				script.id, 
				shotData, 
				index === 0 ? usageMetadata : null,  // 只有第一个分镜保存 usageMetadata
				model
			)
		)
	);

	return {
		shots: savedShots,
		usageMetadata,
		model,
		count: savedShots.length,
		totalDuration // 返回实际总时长
	};
}
