// src/lib/server/services/utils/errorHandler.ts
/**
 * 统一错误处理工具
 * 提供一致的错误处理和日志记录
 */

/**
 * 工作流错误结果
 */
export interface ErrorResult {
	status: 'failed';
	error: string;
}

/**
 * 从错误对象中提取错误消息
 * 
 * @param error - 错误对象
 * @returns 错误消息字符串
 */
export function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return 'Unknown error';
}

/**
 * 记录错误日志
 * 
 * @param context - 错误上下文（函数名或模块名）
 * @param error - 错误对象
 */
export function logError(context: string, error: unknown): void {
	console.error(`❌ Error in ${context}:`, error);
	
	if (error instanceof Error && error.stack) {
		console.error('Stack trace:', error.stack);
	}
}

/**
 * 创建带错误处理的异步函数包装器
 * 
 * @param fn - 要包装的异步函数
 * @param context - 错误上下文
 * @returns 包装后的函数
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
	fn: T,
	context: string
): T {
	return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
		try {
			return await fn(...args);
		} catch (error) {
			logError(context, error);
			throw error;
		}
	}) as T;
}

/**
 * 创建带错误恢复的工作流包装器
 * 
 * @param fn - 工作流函数
 * @param context - 错误上下文
 * @returns 包装后的函数，失败时返回 ErrorResult
 */
export function withWorkflowErrorHandling<T, E extends ErrorResult>(
	fn: () => Promise<T>,
	context: string
): Promise<T | E> {
	return fn().catch((error) => {
		logError(context, error);
		return {
			status: 'failed',
			error: extractErrorMessage(error)
		} as E;
	});
}
