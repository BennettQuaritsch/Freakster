import { json } from '@sveltejs/kit';

import { swapAuthorizationCodeForIOS } from '$lib/server/spotify';
import type { RequestHandler } from './$types';

async function readCode(request: Request): Promise<string | null> {
	const contentType = request.headers.get('content-type') ?? '';

	if (contentType.includes('application/x-www-form-urlencoded')) {
		const text = await request.text();
		return new URLSearchParams(text).get('code');
	}

	if (contentType.includes('multipart/form-data')) {
		const form = await request.formData();
		const value = form.get('code');
		return typeof value === 'string' ? value : null;
	}

	if (contentType.includes('application/json')) {
		try {
			const payload = (await request.json()) as { code?: unknown };
			return typeof payload.code === 'string' ? payload.code : null;
		} catch {
			return null;
		}
	}

	const text = await request.text();
	return new URLSearchParams(text).get('code');
}

export const POST: RequestHandler = async ({ request }) => {
	const code = await readCode(request);
	if (!code) {
		return json({ error: 'invalid_request', error_description: 'Missing code' }, { status: 400 });
	}

	try {
		const result = await swapAuthorizationCodeForIOS(code);
		return json(result.body, { status: result.status });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unexpected token swap error.';
		console.error('[spotify/ios/swap]', message);
		return json({ error: 'server_error', error_description: message }, { status: 500 });
	}
};
