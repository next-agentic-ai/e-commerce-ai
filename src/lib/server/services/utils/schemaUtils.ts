// src/lib/server/services/utils/schemaUtils.ts
/**
 * Zod Schema 工具
 * 提供统一的 Schema 转换和验证功能
 */

import { z } from 'zod';

/**
 * 将 Zod Schema 转换为 OpenAPI 3.0 JSON Schema
 * 
 * @param schema - Zod Schema
 * @returns JSON Schema 对象
 */
export function zodToJsonSchema<T extends z.ZodType>(schema: T): object {
	return z.toJSONSchema(schema, {
		target: 'openapi-3.0',
	});
}

/**
 * 解析和验证 JSON 字符串
 * 
 * @param jsonText - JSON 字符串
 * @param schema - Zod Schema
 * @returns 解析后的数据
 * @throws 如果解析或验证失败
 */
export function parseAndValidateJson<T>(
	jsonText: string,
	schema: z.ZodType<T>
): T {
	try {
		const rawData = JSON.parse(jsonText);
		return schema.parse(rawData);
	} catch (error) {
		console.error('Failed to parse or validate JSON:', jsonText);
		console.error('Validation error:', error);
		throw new Error('Failed to parse and validate JSON');
	}
}

/**
 * 安全解析 JSON（返回 null 而不是抛出错误）
 * 
 * @param jsonText - JSON 字符串
 * @param schema - Zod Schema
 * @returns 解析后的数据或 null
 */
export function safeParseJson<T>(
	jsonText: string,
	schema: z.ZodType<T>
): T | null {
	try {
		return parseAndValidateJson(jsonText, schema);
	} catch {
		return null;
	}
}
