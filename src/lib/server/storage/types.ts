// src/lib/server/storage/types.ts

/**
 * 存储提供商接口
 */
export interface StorageProvider {
	/** 提供商名称 */
	name: string;

	/** 上传文件 */
	upload(file: File | Buffer, path: string): Promise<string>;

	/** 删除文件 */
	delete(path: string): Promise<void>;

	/** 获取访问URL */
	getUrl(path: string): string;

	/** 获取签名URL（私有文件） */
	getSignedUrl(path: string, expiresIn?: number): Promise<string>;

	/** 检查文件是否存在 */
	exists(path: string): Promise<boolean>;

	/** 复制文件到另一个存储 */
	copyTo(path: string, targetProvider: StorageProvider): Promise<string>;
}

export type StorageType = 'local' | 'supabase' | 's3' | 'cloudflare' | 'cdn';
