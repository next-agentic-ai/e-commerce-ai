import { paraglideVitePlugin } from '@inlang/paraglide-js';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// 加载 .env 文件到 process.env
	const env = loadEnv(mode, process.cwd(), '');
	
	// 将环境变量注入到 process.env
	Object.assign(process.env, env);

	return {
		plugins: [
			tailwindcss(),
			sveltekit(),
			devtoolsJson(),
			paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })
		]
	};
});
