// src/lib/server/storage/local.ts
import { writeFile, unlink, access, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import type { StorageProvider } from './types';

/**
 * 本地文件系统存储实现
 */
export class LocalStorage implements StorageProvider {
	name = 'local';
	private baseDir: string;
	private baseUrl: string;

	constructor(baseDir = 'storage', baseUrl = '/storage') {
		this.baseDir = baseDir;
		this.baseUrl = baseUrl;
	}

	/**
	 * 上传文件
	 */
	async upload(file: File | Buffer, path: string): Promise<string> {
		const fullPath = join(this.baseDir, path);
		
		// 确保目录存在
		await mkdir(dirname(fullPath), { recursive: true });

		// 写入文件
		if (file instanceof Buffer) {
			await writeFile(fullPath, file);
		} else {
			const buffer = Buffer.from(await file.arrayBuffer());
			await writeFile(fullPath, buffer);
		}

		return path;
	}

	/**
	 * 删除文件
	 */
	async delete(path: string): Promise<void> {
		const fullPath = join(this.baseDir, path);
		try {
			await unlink(fullPath);
		} catch (error) {
			// 文件不存在时忽略错误
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}

	/**
	 * 获取访问URL
	 */
	getUrl(path: string): string {
		return `${this.baseUrl}/${path}`;
	}

	/**
	 * 获取签名URL（本地存储不需要签名）
	 */
	async getSignedUrl(path: string, _expiresIn?: number): Promise<string> {
		return this.getUrl(path);
	}

	/**
	 * 检查文件是否存在
	 */
	async exists(path: string): Promise<boolean> {
		const fullPath = join(this.baseDir, path);
		try {
			await access(fullPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 复制文件到另一个存储
	 */
	async copyTo(path: string, targetProvider: StorageProvider): Promise<string> {
		const fullPath = join(this.baseDir, path);
		const buffer = await readFile(fullPath);
		return await targetProvider.upload(buffer, path);
	}

	/**
	 * 获取完整路径
	 */
	getFullPath(path: string): string {
		return join(this.baseDir, path);
	}
}

// 默认实例
export const localStorage = new LocalStorage();
