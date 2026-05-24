import type { RequestEvent } from '@sveltejs/kit';

import { badRequest, notFound, unauthorized } from '$lib/server/http-errors';
import { getValidSpotifyAccessToken } from '$lib/server/spotify';

const APP_SESSION_COOKIE = 'freakster_app_session';

export async function requireSpotifyAuth(
	event: Pick<RequestEvent, 'url' | 'cookies'>
): Promise<string> {
	const token = await getValidSpotifyAccessToken(event);
	if (!token) {
		unauthorized('Spotify authentication required. Connect Spotify and try again.');
	}

	return token;
}

export function getOrCreateAppSessionId(event: Pick<RequestEvent, 'url' | 'cookies'>): string {
	const existing = event.cookies.get(APP_SESSION_COOKIE)?.trim() ?? '';
	if (existing) {
		return existing;
	}

	const sessionId = crypto.randomUUID();
	event.cookies.set(APP_SESSION_COOKIE, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * 365
	});

	return sessionId;
}

export function requireJobId(jobId: string | null | undefined): string {
	const value = jobId?.trim() ?? '';
	if (!value) {
		badRequest('Missing job id.');
	}

	return value;
}

export function requireAppSessionId(event: Pick<RequestEvent, 'cookies'>): string {
	const ownerSessionId = event.cookies.get(APP_SESSION_COOKIE)?.trim() ?? '';
	if (!ownerSessionId) {
		notFound('Playlist job not found or expired.');
	}

	return ownerSessionId;
}

export async function parseJsonBody(event: Pick<RequestEvent, 'request'>): Promise<unknown> {
	try {
		return await event.request.json();
	} catch {
		badRequest('Invalid request payload.');
	}
}
