// src/routes/storage/[...path]/+server.ts
import { error } from '@sveltejs/kit';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { lookup } from 'mrmime';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const path = params.path;

	if (!path) {
		throw error(400, 'Path is required');
	}

	// 防止路径遍历攻击
	if (path.includes('..') || path.startsWith('/')) {
		throw error(400, 'Invalid path');
	}

	const fullPath = join('storage', path);

	try {
		const file = await readFile(fullPath);
		const mimeType = lookup(path) || 'application/octet-stream';

		return new Response(file, {
			headers: {
				'Content-Type': mimeType,
				'Cache-Control': 'public, max-age=31536000'
			}
		});
	} catch (err) {
		console.error('File read error:', err);
		throw error(404, 'File not found');
	}
};
