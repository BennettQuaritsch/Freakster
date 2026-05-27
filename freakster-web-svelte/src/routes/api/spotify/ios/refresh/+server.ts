import { json } from '@sveltejs/kit';

import { refreshIOSAccessToken } from '$lib/server/spotify';
import type { RequestHandler } from './$types';

async function readRefreshToken(request: Request): Promise<string | null> {
	const contentType = request.headers.get('content-type') ?? '';

	if (contentType.includes('application/x-www-form-urlencoded')) {
		const text = await request.text();
		return new URLSearchParams(text).get('refresh_token');
	}

	if (contentType.includes('multipart/form-data')) {
		const form = await request.formData();
		const value = form.get('refresh_token');
		return typeof value === 'string' ? value : null;
	}

	if (contentType.includes('application/json')) {
		try {
			const payload = (await request.json()) as { refresh_token?: unknown };
			return typeof payload.refresh_token === 'string' ? payload.refresh_token : null;
		} catch {
			return null;
		}
	}

	const text = await request.text();
	return new URLSearchParams(text).get('refresh_token');
}

export const POST: RequestHandler = async ({ request }) => {
	const refreshToken = await readRefreshToken(request);
	if (!refreshToken) {
		return json(
			{ error: 'invalid_request', error_description: 'Missing refresh_token' },
			{ status: 400 }
		);
	}

	try {
		const result = await refreshIOSAccessToken(refreshToken);
		return json(result.body, { status: result.status });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unexpected token refresh error.';
		console.error('[spotify/ios/refresh]', message);
		return json({ error: 'server_error', error_description: message }, { status: 500 });
	}
};
