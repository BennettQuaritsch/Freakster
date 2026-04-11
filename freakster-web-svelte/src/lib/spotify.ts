import type { SongCardData } from '$lib/types/song-card';
import { env } from '$env/dynamic/public';

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_SCOPE = 'playlist-read-private playlist-read-collaborative';
const SPOTIFY_PLAYLIST_PAGE_LIMIT = 50;
const CODE_VERIFIER_KEY = 'freakster_pkce_code_verifier';
const TOKEN_KEY = 'freakster_spotify_access_token';
const TOKEN_EXPIRY_KEY = 'freakster_spotify_access_token_expires_at';
const REFRESH_TOKEN_KEY = 'freakster_spotify_refresh_token';
const OAUTH_STATE_KEY = 'freakster_spotify_oauth_state';

const SPOTIFY_REDIRECT_ERROR = 'SPOTIFY_AUTH_REDIRECT';

export class SpotifyAuthRedirectError extends Error {
	readonly code = SPOTIFY_REDIRECT_ERROR;

	constructor() {
		super('Redirecting to Spotify authentication');
	}
}

export function isSpotifyAuthRedirectError(error: unknown): error is SpotifyAuthRedirectError {
	return error instanceof SpotifyAuthRedirectError;
}

class SpotifyApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

type SpotifyPlaylistItemsResponse = {
	items?: Array<{
		track?: SpotifyTrack | null;
		item?: SpotifyTrack | null;
	}>;
	next?: string | null;
};

type SpotifyTrack = {
	type?: string;
	id?: string;
	name?: string;
	artists?: Array<{ name?: string }>;
	external_urls?: { spotify?: string };
	external_ids?: { isrc?: string };
};

export type PlaylistTracksResult = {
	songs: SongCardData[];
	skippedWithoutSpotifyUrl: number;
};

export function extractPlaylistId(playlistRef: string): string {
	const value = playlistRef.trim();
	if (!value) {
		throw new Error('Playlist reference is empty');
	}

	try {
		const parsed = new URL(value);
		const segments = parsed.pathname.split('/').filter(Boolean);
		const playlistSegmentIndex = segments.findIndex(
			(segment) => segment.toLowerCase() === 'playlist'
		);
		const playlistSegment =
			playlistSegmentIndex >= 0 ? (segments[playlistSegmentIndex + 1]?.trim() ?? '') : '';
		const playlistIdFromUrl = /^([A-Za-z0-9]+)/.exec(playlistSegment)?.[1];
		if (playlistIdFromUrl) {
			return playlistIdFromUrl;
		}
	} catch {
		// Not a URL input; continue with URI/ID extraction.
	}

	const uriMatch = /(?:^|:)playlist:([A-Za-z0-9]+)/.exec(value);
	if (uriMatch?.[1]) {
		return uriMatch[1];
	}

	const match = /playlist\/([A-Za-z0-9]+)/.exec(value);
	if (match?.[1]) {
		return match[1];
	}

	const plainId = /^([A-Za-z0-9]+)/.exec(value);
	if (plainId?.[1]) {
		return plainId[1];
	}

	return value;
}

export async function ensureSpotifyAccessToken(): Promise<string> {
	const url = new URL(window.location.href);
	const authCode = url.searchParams.get('code');
	const authState = url.searchParams.get('state');
	const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);

	if (authCode) {
		if (!authState || !expectedState || authState !== expectedState) {
			throw new Error('Spotify authentication state mismatch. Please try again.');
		}

		sessionStorage.removeItem(OAUTH_STATE_KEY);
		const token = await exchangeAuthorizationCode(authCode);
		url.searchParams.delete('code');
		url.searchParams.delete('state');
		history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
		return token;
	}

	const stored = getStoredToken();
	if (stored) {
		return stored;
	}

	const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
	if (refreshToken) {
		const refreshed = await refreshAccessToken(refreshToken);
		if (refreshed) {
			return refreshed;
		}
	}

	await redirectToSpotifyAuth();
	throw new SpotifyAuthRedirectError();
}

async function redirectToSpotifyAuth(): Promise<void> {
	const clientId = env.PUBLIC_SPOTIFY_CLIENT_ID;
	const redirectUri = env.PUBLIC_SPOTIFY_REDIRECT_URI || window.location.origin + '/';

	if (!clientId) {
		throw new Error('Missing PUBLIC_SPOTIFY_CLIENT_ID in environment');
	}

	const verifier = generateRandomString(64);
	const state = generateRandomString(16);
	sessionStorage.setItem(CODE_VERIFIER_KEY, verifier);
	sessionStorage.setItem(OAUTH_STATE_KEY, state);
	const challenge = await createCodeChallenge(verifier);

	const params = new URLSearchParams({
		client_id: clientId,
		response_type: 'code',
		redirect_uri: redirectUri,
		scope: SPOTIFY_SCOPE,
		state,
		code_challenge_method: 'S256',
		code_challenge: challenge
	});

	window.location.assign(`${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`);
}

function getStoredToken(): string | null {
	const token = localStorage.getItem(TOKEN_KEY);
	const expiresAt = localStorage.getItem(TOKEN_EXPIRY_KEY);

	if (!token || !expiresAt) {
		return null;
	}

	if (Date.now() >= Number(expiresAt)) {
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(TOKEN_EXPIRY_KEY);
		return null;
	}

	return token;
}

function clearStoredAuthTokens(): void {
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(TOKEN_EXPIRY_KEY);
	localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function persistToken(token: string, expiresInSeconds: number): void {
	const expiresAt = Date.now() + Math.max(60, expiresInSeconds - 30) * 1000;
	localStorage.setItem(TOKEN_KEY, token);
	localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
}

async function exchangeAuthorizationCode(code: string): Promise<string> {
	const verifier = sessionStorage.getItem(CODE_VERIFIER_KEY);
	const clientId = env.PUBLIC_SPOTIFY_CLIENT_ID;
	const redirectUri = env.PUBLIC_SPOTIFY_REDIRECT_URI || window.location.origin + '/';

	if (!verifier) {
		throw new Error('Missing PKCE verifier. Please restart Spotify login.');
	}

	if (!clientId) {
		throw new Error('Missing PUBLIC_SPOTIFY_CLIENT_ID in environment');
	}

	const response = await fetch(SPOTIFY_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: verifier
		})
	});

	if (!response.ok) {
		throw new Error(`Spotify token exchange failed: ${response.status} ${response.statusText}`);
	}

	const payload = (await response.json()) as {
		access_token: string;
		expires_in: number;
		refresh_token?: string;
	};

	persistToken(payload.access_token, payload.expires_in);
	if (payload.refresh_token) {
		localStorage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
	}
	sessionStorage.removeItem(CODE_VERIFIER_KEY);

	return payload.access_token;
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
	const clientId = env.PUBLIC_SPOTIFY_CLIENT_ID;
	if (!clientId) {
		return null;
	}

	const response = await fetch(SPOTIFY_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: clientId
		})
	});

	if (!response.ok) {
		localStorage.removeItem(REFRESH_TOKEN_KEY);
		return null;
	}

	const payload = (await response.json()) as {
		access_token: string;
		expires_in: number;
		refresh_token?: string;
	};

	persistToken(payload.access_token, payload.expires_in);
	if (payload.refresh_token) {
		localStorage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
	}

	return payload.access_token;
}

function generateRandomString(length: number): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const randomValues = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join('');
}

async function createCodeChallenge(verifier: string): Promise<string> {
	const data = new TextEncoder().encode(verifier);
	const hash = await crypto.subtle.digest('SHA-256', data);
	const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fetchSpotifyJson<T>(url: string, token: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`
		}
	});

	let spotifyErrorReason = '';
	const wwwAuthenticate = response.headers.get('www-authenticate')?.toLowerCase() ?? '';
	if (!response.ok) {
		const errorBody = await response.text().catch(() => '');
		let payload: { error?: { message?: string; status?: number } | string } | null = null;
		if (errorBody) {
			try {
				payload = JSON.parse(errorBody) as {
					error?: { message?: string; status?: number } | string;
				};
			} catch {
				payload = null;
			}
		}

		if (typeof payload?.error === 'string') {
			spotifyErrorReason = payload.error;
		} else if (payload?.error?.message) {
			spotifyErrorReason = payload.error.message;
		} else if (errorBody.trim()) {
			spotifyErrorReason = errorBody.trim();
		}
	}

	if (response.status === 401) {
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(TOKEN_EXPIRY_KEY);
		throw new SpotifyApiError(401, 'Spotify access token expired or invalid.');
	}

	if (response.status === 403) {
		const reason = spotifyErrorReason.toLowerCase();

		if (
			reason.includes('scope') ||
			reason.includes('insufficient') ||
			wwwAuthenticate.includes('insufficient_scope')
		) {
			throw new SpotifyApiError(
				403,
				'Spotify denied playlist access. Spotify token is missing required playlist scopes. Reconnect Spotify and approve playlist access permissions.'
			);
		}

		if (reason.includes('user not registered') || reason.includes('development mode')) {
			throw new SpotifyApiError(
				403,
				'Spotify denied playlist access. This Spotify account is not allow-listed for the app in Spotify Developer Dashboard development mode.'
			);
		}

		const detail = spotifyErrorReason ? ` Spotify says: ${spotifyErrorReason}.` : '';
		throw new SpotifyApiError(
			403,
			`Spotify denied playlist access.${detail} Spotify sometimes blocks specific playlist types in Web API even when they are visible in the Spotify app. If this is unexpected, reconnect Spotify with account picker and try again.`
		);
	}

	if (!response.ok) {
		throw new SpotifyApiError(
			response.status,
			`Spotify request failed: ${response.status} ${response.statusText}`
		);
	}

	return (await response.json()) as T;
}

export async function getPlaylistTracks(
	playlistRef: string,
	token: string
): Promise<PlaylistTracksResult> {
	const playlistId = extractPlaylistId(playlistRef);
	let nextUrl: string | null =
		`${SPOTIFY_API_BASE}/playlists/${playlistId}/items?limit=${SPOTIFY_PLAYLIST_PAGE_LIMIT}`;
	let activeToken = token;
	let hasRetriedWithFreshToken = false;
	const songs: SongCardData[] = [];
	let skippedWithoutSpotifyUrl = 0;

	while (nextUrl) {
		let page: SpotifyPlaylistItemsResponse;
		try {
			page = await fetchSpotifyJson<SpotifyPlaylistItemsResponse>(nextUrl, activeToken);
		} catch (error) {
			if (
				error instanceof SpotifyApiError &&
				(error.status === 401 || error.status === 403) &&
				!hasRetriedWithFreshToken
			) {
				hasRetriedWithFreshToken = true;
				clearStoredAuthTokens();
				activeToken = await ensureSpotifyAccessToken();
				continue;
			}

			if (error instanceof SpotifyApiError && error.status === 403) {
				throw new Error(error.message, { cause: error });
			}

			throw error;
		}

		hasRetriedWithFreshToken = false;
		for (const item of page.items ?? []) {
			const track = item?.track ?? item?.item;
			if (!track || track.type !== 'track') {
				continue;
			}

			const artists = (track.artists ?? [])
				.map((artist: { name?: string }) => artist?.name?.trim())
				.filter((value: string | undefined): value is string => Boolean(value));

			const artistName = artists.length > 0 ? artists.join(', ') : 'Unknown Artist';
			const songName = track.name?.trim() || 'Unknown Song';
			const trackId = track.id?.trim() || '';
			const spotifyUrl =
				track.external_urls?.spotify?.trim() ||
				(trackId ? `https://open.spotify.com/track/${trackId}` : '');

			if (!spotifyUrl) {
				skippedWithoutSpotifyUrl += 1;
				continue;
			}

			songs.push({
				artist_name: artistName,
				song_name: songName,
				spotify_url: spotifyUrl,
				isrc: track.external_ids?.isrc?.trim() || null,
				release_date: null
			});
		}

		nextUrl = page.next ?? null;
	}

	return {
		songs,
		skippedWithoutSpotifyUrl
	};
}
