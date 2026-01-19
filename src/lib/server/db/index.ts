import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// 使用 process.env.DATABASE_URL
// Vite 会在开发时自动加载 .env 文件
// Worker 使用 dotenv 手动加载
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
	throw new Error(
		'DATABASE_URL is not set. Please set it in .env file or environment variables.'
	);
}

const client = postgres(DATABASE_URL);

export const db = drizzle(client, { schema });
