import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

import { clearSpotifyAuthCookies, exchangeAuthorizationCode } from '$lib/server/spotify';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const code = event.url.searchParams.get('code');
	const state = event.url.searchParams.get('state');
	const error = event.url.searchParams.get('error');

	if (error) {
		clearSpotifyAuthCookies(event);
		throw redirect(
			303,
			`${base}/?error=${encodeURIComponent('Spotify authorization was denied or canceled.')}`
		);
	}

	if (!code) {
		clearSpotifyAuthCookies(event);
		throw redirect(
			303,
			`${base}/?error=${encodeURIComponent('Missing Spotify authorization code.')}`
		);
	}

	try {
		await exchangeAuthorizationCode(event, code, state);
	} catch (authError) {
		clearSpotifyAuthCookies(event);
		const message =
			authError instanceof Error ? authError.message : 'Failed to complete Spotify authentication.';
		throw redirect(303, `${base}/?error=${encodeURIComponent(message)}`);
	}

	throw redirect(303, `${base}/?spotify=connected`);
};
