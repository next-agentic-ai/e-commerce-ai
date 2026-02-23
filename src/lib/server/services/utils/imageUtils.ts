// src/lib/server/services/utils/imageUtils.ts
/**
 * 图片处理工具
 * 提供图片格式转换、MIME 类型识别等功能
 */

import { readFile } from 'fs/promises';
import { localStorage } from '../../storage/local';

/**
 * 根据文件扩展名获取 MIME 类型
 * 
 * @param filePath - 文件路径或文件名
 * @returns MIME 类型字符串
 */
export function getMimeType(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase();
	
	const mimeTypeMap: Record<string, string> = {
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		webp: 'image/webp',
		gif: 'image/gif'
	};
	
	return mimeTypeMap[ext || ''] || 'image/jpeg';
}

/**
 * 将图片转换为 base64 数据（不包含 data URI 前缀）
 * 
 * @param imagePath - 图片存储路径（相对路径）
 * @returns base64 编码的字符串
 */
export async function imageToBase64(imagePath: string): Promise<string> {
	const fullPath = localStorage.getFullPath(imagePath);
	const buffer = await readFile(fullPath);
	return buffer.toString('base64');
}

/**
 * 将图片转换为 base64 数据 URI（包含 MIME 类型前缀）
 * 
 * @param imagePath - 图片存储路径（相对路径）
 * @returns 完整的 data URI (data:image/png;base64,...)
 */
export async function imageToBase64WithMime(imagePath: string): Promise<string> {
	const mimeType = getMimeType(imagePath);
	const base64Data = await imageToBase64(imagePath);
	return `data:${mimeType};base64,${base64Data}`;
}

/**
 * 将图片转换为内联数据格式（用于 Gemini API）
 * 
 * @param imagePath - 图片存储路径（相对路径）
 * @returns 内联数据对象
 */
export async function imageToInlineData(imagePath: string): Promise<{
	inlineData: {
		mimeType: string;
		data: string;
	}
}> {
	const mimeType = getMimeType(imagePath);
	const base64Data = await imageToBase64(imagePath);
	
	return {
		inlineData: {
			mimeType,
			data: base64Data
		}
	};
}

/**
 * 批量将图片路径转换为内联数据格式
 * 
 * @param imagePaths - 图片路径列表
 * @returns 内联数据对象列表
 */
export async function imagesToInlineData(imagePaths: string[]): Promise<Array<{
	inlineData: {
		mimeType: string;
		data: string;
	}
}>> {
	return await Promise.all(
		imagePaths.map(path => imageToInlineData(path))
	);
}
