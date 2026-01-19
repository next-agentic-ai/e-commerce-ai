// src/lib/server/services/productImage.ts
import { db } from '../db/index.js';
import { productImage } from '../db/schema.js';
import { localStorage } from '../storage/local.js';
import { eq } from 'drizzle-orm';

export interface UploadProductImageOptions {
	userId: string;
	file: File;
	imageType?: string; // front, side, back, use_case, detail, etc.
	width?: number;
	height?: number;
}

/**
 * 生成唯一的文件路径
 */
function generateFilePath(userId: string, fileName: string): string {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	const ext = fileName.split('.').pop() || 'png';
	return `products/${userId}/${timestamp}_${random}.${ext}`;
}

/**
 * 上传产品图片
 */
export async function uploadProductImage(options: UploadProductImageOptions) {
	const { userId, file, imageType, width, height } = options;

	// 读取文件
	const buffer = Buffer.from(await file.arrayBuffer());

	// 生成存储路径
	const path = generateFilePath(userId, file.name);

	// 上传到本地存储
	await localStorage.upload(buffer, path);

	// 插入数据库
	const [inserted] = await db
		.insert(productImage)
		.values({
			userId,
			name: file.name, // 保存原始文件名
			path,
			storageType: 'local',
			imageType,
			width,
			height,
			fileSize: buffer.length
		})
		.returning();

	return inserted;
}

/**
 * 批量上传产品图片
 */
export async function uploadProductImages(
	userId: string,
	files: { file: File; width?: number; height?: number }[],
	imageTypes?: string[]
) {
	const uploadPromises = files.map((item, index) =>
		uploadProductImage({
			userId,
			file: item.file,
			imageType: imageTypes?.[index],
			width: item.width,
			height: item.height
		})
	);

	return await Promise.all(uploadPromises);
}

/**
 * 删除产品图片
 */
export async function deleteProductImage(imageId: string, userId: string) {
	// 查询图片信息
	const [image] = await db
		.select()
		.from(productImage)
		.where(eq(productImage.id, imageId))
		.limit(1);

	if (!image) {
		throw new Error('Image not found');
	}

	if (image.userId !== userId) {
		throw new Error('Unauthorized');
	}

	// 删除文件
	await localStorage.delete(image.path);

	// 删除数据库记录
	await db.delete(productImage).where(eq(productImage.id, imageId));

	return true;
}

/**
 * 获取用户的所有产品图片
 */
export async function getUserProductImages(userId: string, searchQuery?: string) {
	const { ilike, and } = await import('drizzle-orm');
	
	// 构建查询条件
	const conditions = [eq(productImage.userId, userId)];
	
	// 如果有搜索词，添加搜索条件
	if (searchQuery && searchQuery.trim() !== '') {
		conditions.push(ilike(productImage.name, `%${searchQuery.trim()}%`));
	}

	const images = await db
		.select()
		.from(productImage)
		.where(and(...conditions))
		.orderBy(productImage.createdAt);

	return images.map((img) => ({
		...img,
		url: localStorage.getUrl(img.path)
	}));
}

/**
 * 获取单个产品图片
 */
export async function getProductImage(imageId: string) {
	const [image] = await db
		.select()
		.from(productImage)
		.where(eq(productImage.id, imageId))
		.limit(1);

	if (!image) {
		return null;
	}

	return {
		...image,
		url: localStorage.getUrl(image.path)
	};
}
