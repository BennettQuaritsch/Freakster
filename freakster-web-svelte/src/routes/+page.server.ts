import { clearSpotifyAuthCookies, hasSpotifySession } from '$lib/server/spotify';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const error = url.searchParams.get('error');
	const spotifyConnected = hasSpotifySession(cookies);

	return {
		error,
		spotifyConnected,
		justConnected: url.searchParams.get('spotify') === 'connected'
	};
};

export const actions: Actions = {
	disconnectSpotify: async (event) => {
		clearSpotifyAuthCookies(event);
		return { disconnected: true };
	}
};
