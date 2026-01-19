// worker.ts
/**
 * PgBoss Worker 进程
 * 独立运行，处理后台任务
 * 
 * 特性：
 * - 自动加载环境变量
 * - 优雅关闭
 * - 错误重启机制
 * - 健康检查日志
 * - 性能监控
 */

// 加载环境变量
import dotenv from 'dotenv';
dotenv.config();

// 颜色输出辅助函数（可选）
const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
	gray: '\x1b[90m'
};

function log(emoji: string, message: string, color = colors.reset) {
	const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
	console.log(`${colors.gray}[${timestamp}]${colors.reset} ${emoji} ${color}${message}${colors.reset}`);
}

// 验证必需的环境变量
function validateEnvironment() {
	const required = ['DATABASE_URL', 'GEMINI_API_KEY'];
	const missing = required.filter(key => !process.env[key]);
	
	if (missing.length > 0) {
		log('❌', `Missing required environment variables: ${missing.join(', ')}`, colors.red);
		log('💡', 'Please create a .env file with the required variables', colors.yellow);
		process.exit(1);
	}
	
	log('✅', 'Environment variables loaded', colors.green);
	log('📍', `DATABASE_URL: ${process.env.DATABASE_URL!.replace(/:[^:@]+@/, ':****@')}`, colors.cyan);
	log('📍', `GEMINI_API_KEY: ${process.env.GEMINI_API_KEY!.substring(0, 10)}...`, colors.cyan);
}

validateEnvironment();

// 全局变量用于追踪状态
let isShuttingDown = false;
let workerStartTime = Date.now();
let jobsProcessed = 0;

// 统计信息
function logStats() {
	const uptime = Math.floor((Date.now() - workerStartTime) / 1000);
	const hours = Math.floor(uptime / 3600);
	const minutes = Math.floor((uptime % 3600) / 60);
	const seconds = uptime % 60;
	
	log('📊', `Uptime: ${hours}h ${minutes}m ${seconds}s | Jobs processed: ${jobsProcessed}`, colors.cyan);
}

// 定期输出统计信息（每10分钟）
setInterval(() => {
	if (!isShuttingDown) {
		logStats();
	}
}, 10 * 60 * 1000);

async function startWorker() {
	log('🚀', 'Starting PgBoss Worker...', colors.bright);

	try {
		// 动态导入，确保在 dotenv.config() 之后执行
		const { startPgBoss, stopPgBoss, registerJobHandlers } = await import('./src/lib/server/jobs/index.js');

		// 启动 PgBoss
		log('🔌', 'Connecting to database...', colors.cyan);
		await startPgBoss();

		// 注册任务处理器
		log('📝', 'Registering job handlers...', colors.cyan);
		await registerJobHandlers();

		log('✅', 'Worker is ready and listening for jobs', colors.green);
		log('💡', 'Press Ctrl+C to stop', colors.gray);
		
		// 优雅关闭处理
		const shutdown = async (signal: string) => {
			if (isShuttingDown) {
				log('⚠️', 'Force shutdown initiated', colors.yellow);
				process.exit(1);
			}
			
			isShuttingDown = true;
			log('⏳', `Received ${signal}, shutting down gracefully...`, colors.yellow);
			logStats();
			
			try {
				await stopPgBoss();
				log('✅', 'Worker stopped gracefully', colors.green);
				process.exit(0);
			} catch (error) {
				log('❌', `Error during shutdown: ${error}`, colors.red);
				process.exit(1);
			}
		};

		process.on('SIGTERM', () => shutdown('SIGTERM'));
		process.on('SIGINT', () => shutdown('SIGINT'));
		
		// 捕获未处理的错误
		process.on('unhandledRejection', (reason, promise) => {
			log('❌', `Unhandled Rejection at: ${promise}, reason: ${reason}`, colors.red);
			// 不退出，让进程管理器决定是否重启
		});
		
		process.on('uncaughtException', (error) => {
			log('❌', `Uncaught Exception: ${error.message}`, colors.red);
			console.error(error.stack);
			// 异步关闭以确保日志输出
			setTimeout(() => process.exit(1), 1000);
		});

	} catch (error) {
		log('❌', `Failed to start worker: ${error}`, colors.red);
		if (error instanceof Error) {
			console.error(error.stack);
		}
		process.exit(1);
	}
}

// 启动 worker
startWorker().catch((error) => {
	log('❌', `Fatal error: ${error}`, colors.red);
	process.exit(1);
});

// 显示版本信息
log('📦', `Node.js ${process.version}`, colors.gray);
log('🏷️', `Worker PID: ${process.pid}`, colors.gray);
