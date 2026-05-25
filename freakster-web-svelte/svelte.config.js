import nodeAdapter from '@sveltejs/adapter-node';
import vercelAdapter from '@sveltejs/adapter-vercel';
import { relative, sep } from 'node:path';

const adapter = process.env.VERCEL_ENV ? vercelAdapter({ runtime: 'nodejs22.x' }) : nodeAdapter();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// defaults to rune mode for the project, execept for `node_modules`. Can be removed in svelte 6.
		runes: ({ filename }) => {
			const relativePath = relative(import.meta.dirname, filename);
			const pathSegments = relativePath.toLowerCase().split(sep);
			const isExternalLibrary = pathSegments.includes('node_modules');

			return isExternalLibrary ? undefined : true;
		}
	},
	kit: { adapter }
};

export default config;
