// src/lib/server/services/utils/apiClients.ts
/**
 * 统一的 API 客户端管理
 * 提供 Google Gemini 和字节跳动 ARK 的客户端实例
 */

import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

/**
 * 获取 Google Gemini 客户端
 */
export function getGeminiClient(): GoogleGenAI {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error('GEMINI_API_KEY environment variable is not set');
	}
	return new GoogleGenAI({ apiKey });
}

/**
 * 获取字节跳动 ARK 客户端
 */
export function getArkClient(): OpenAI {
	const apiKey = process.env.ARK_API_KEY;
	if (!apiKey) {
		throw new Error('ARK_API_KEY environment variable is not set');
	}
	return new OpenAI({ 
		apiKey,
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
		logLevel: 'debug',
	});
}

/**
 * 检查 ARK API Key 是否配置
 */
export function checkArkApiKey(): string {
	const apiKey = process.env.ARK_API_KEY;
	if (!apiKey) {
		throw new Error('ARK_API_KEY environment variable is not set');
	}
	return apiKey;
}

/**
 * 获取 Jamendo Client ID
 */
export function getJamendoClientId(): string {
	const clientId = process.env.JAMENDO_CLIENT_ID;
	if (!clientId) {
		throw new Error('JAMENDO_CLIENT_ID environment variable is not set');
	}
	return clientId;
}
