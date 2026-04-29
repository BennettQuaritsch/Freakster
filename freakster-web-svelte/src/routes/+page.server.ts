import { clearSpotifyAuthCookies, hasValidSpotifySession } from '$lib/server/spotify';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const error = url.searchParams.get('error');
	const spotifyConnected = await hasValidSpotifySession(event);

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
