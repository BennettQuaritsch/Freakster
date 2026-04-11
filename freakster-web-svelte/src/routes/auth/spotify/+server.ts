import { redirect } from '@sveltejs/kit';

import { createSpotifyAuthorizationUrl } from '$lib/server/spotify';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const authorizationUrl = createSpotifyAuthorizationUrl(event, { forceAccountPicker: true });
	throw redirect(302, authorizationUrl.toString());
};
