// src/lib/server/jobs/pgBoss.ts
import { PgBoss } from 'pg-boss';
import { JOB_NAMES } from './types';

let boss: PgBoss | null = null;
let isStarted = false;
let startPromise: Promise<void> | null = null;
let mode: 'web' | 'worker' | null = null;

/**
 * 获取 PgBoss 单例实例
 */
export function getPgBoss(): PgBoss {
	if (!boss) {
		const connectionString = process.env.DATABASE_URL;
		
		if (!connectionString) {
			throw new Error('DATABASE_URL environment variable is not set');
		}

		boss = new PgBoss({
			connectionString,
			schema: 'pgboss', // 使用单独的 schema
			
			// 监控配置（仅在 worker 模式下启用）
			...(mode === 'worker' && {
				monitorStateIntervalSeconds: 60,
				maintenanceIntervalSeconds: 3600,
			}),
		});

		// 错误处理
		boss.on('error', (error) => {
			console.error(`PgBoss error (${mode} mode):`, error);
		});
	}

	return boss;
}

/**
 * 确保 PgBoss 已启动（用于 Web 环境发送任务）
 * Web 模式：只启动必要的功能用于发送任务
 */
export async function ensurePgBossStarted(): Promise<void> {
	if (isStarted) {
		return;
	}

	// 如果正在启动，等待启动完成
	if (startPromise) {
		return startPromise;
	}

	// 设置为 Web 模式
	mode = 'web';

	// 开始启动
	startPromise = (async () => {
		const boss = getPgBoss();
		await boss.start();
		
		// 创建队列（如果不存在）
		await boss.createQueue(JOB_NAMES.UGC_VIDEO_WORKFLOW);
		await boss.createQueue(JOB_NAMES.POLL_VIDEO_STATUS);
		await boss.createQueue(JOB_NAMES.IMAGE_GENERATION_WORKFLOW);
		
		isStarted = true;
		startPromise = null;
		console.log('✅ PgBoss started (Web mode - Producer only)');
	})();

	return startPromise;
}

/**
 * 启动 PgBoss（用于 Worker 环境）
 * Worker 模式：启动完整功能，包括监控、维护、任务处理
 */
export async function startPgBoss(): Promise<void> {
	if (isStarted) {
		console.log('⚠️  PgBoss already started');
		return;
	}

	// 设置为 Worker 模式
	mode = 'worker';

	const boss = getPgBoss();
	
	if (!boss) {
		throw new Error('PgBoss instance not initialized');
	}

	await boss.start();
	isStarted = true;
	console.log('✅ PgBoss started (Worker mode - Consumer)');
}

/**
 * 停止 PgBoss（优雅关闭）
 */
export async function stopPgBoss(): Promise<void> {
	if (boss) {
		await boss.stop({
			graceful: true,
			timeout: 30000 // 30秒超时
		});
		console.log(`✅ PgBoss stopped gracefully (${mode} mode)`);
		boss = null;
		isStarted = false;
		startPromise = null;
		mode = null;
	}
}

/**
 * 获取当前运行模式
 */
export function getMode(): 'web' | 'worker' | null {
	return mode;
}
