import { env } from '$env/dynamic/private';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

import type { SongCardData } from '$lib/types/song-card';

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_SCOPE = 'playlist-read-private playlist-read-collaborative';
const SPOTIFY_PLAYLIST_PAGE_LIMIT = 50;
const REQUIRED_SCOPES = SPOTIFY_SCOPE.split(' ');

const ACCESS_TOKEN_COOKIE = 'spotify_access_token';
const REFRESH_TOKEN_COOKIE = 'spotify_refresh_token';
const EXPIRES_AT_COOKIE = 'spotify_expires_at';
const OAUTH_STATE_COOKIE = 'spotify_oauth_state';
const SCOPE_COOKIE = 'spotify_scope';

type SpotifyTrack = {
	type?: string;
	id?: string;
	name?: string;
	artists?: Array<{ name?: string }>;
	external_urls?: { spotify?: string };
	external_ids?: { isrc?: string };
	album?: { release_date?: string };
};

type SpotifyPlaylistItemsResponse = {
	items?: Array<{
		track?: SpotifyTrack | null;
		item?: SpotifyTrack | null;
	}>;
	next?: string | null;
};

type SpotifyPlaylistMetaResponse = {
	id?: string;
	name?: string;
	public?: boolean | null;
	collaborative?: boolean;
	owner?: {
		id?: string;
	};
};

type SpotifyCurrentUserPlaylistsResponse = {
	items?: Array<{
		id?: string;
	}>;
};

type SpotifyTokenResponse = {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	scope?: string;
};

export type PlaylistTracksResult = {
	songs: SongCardData[];
	skippedWithoutSpotifyUrl: number;
};

class SpotifyApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function getErrorDetails(error: unknown): string {
	if (!(error instanceof Error)) {
		return '';
	}

	const detailParts = [error.message.trim()].filter(Boolean);
	const cause = (error as Error & { cause?: unknown }).cause;
	if (cause instanceof Error && cause.message.trim()) {
		detailParts.push(cause.message.trim());
	} else if (typeof cause === 'object' && cause !== null) {
		const code = (cause as { code?: unknown }).code;
		if (typeof code === 'string' && code.trim()) {
			detailParts.push(code.trim());
		}
	}

	return detailParts.join(' | ');
}

function getSpotifyEnv(): {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
} {
	const clientId = env.SPOTIFY_CLIENT_ID ?? '';
	const clientSecret = env.SPOTIFY_CLIENT_SECRET ?? '';
	const redirectUri = env.SPOTIFY_REDIRECT_URI ?? '';

	if (!clientId) {
		throw new Error('Missing SPOTIFY_CLIENT_ID in environment');
	}

	if (!clientSecret) {
		throw new Error('Missing SPOTIFY_CLIENT_SECRET in environment');
	}

	if (!redirectUri) {
		throw new Error('Missing SPOTIFY_REDIRECT_URI in environment');
	}

	return {
		clientId,
		clientSecret,
		redirectUri
	};
}

function isSecureCookie(event: Pick<RequestEvent, 'url'>): boolean {
	return event.url.protocol === 'https:';
}

function cookieOptions(event: Pick<RequestEvent, 'url'>) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: isSecureCookie(event)
	};
}

function hasRequiredScopes(scopeValue: string | null | undefined): boolean {
	if (!scopeValue) {
		return false;
	}

	const granted = new Set(
		scopeValue
			.split(' ')
			.map((value) => value.trim())
			.filter(Boolean)
	);
	return REQUIRED_SCOPES.every((scope) => granted.has(scope));
}

function generateRandomString(length: number): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const randomValues = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join('');
}

export function createSpotifyAuthorizationUrl(
	event: Pick<RequestEvent, 'url' | 'cookies'>,
	options: { forceAccountPicker?: boolean } = {}
): URL {
	const spotifyEnv = getSpotifyEnv();
	clearSpotifyAuthCookies(event);

	const state = generateRandomString(32);
	event.cookies.set(OAUTH_STATE_COOKIE, state, {
		...cookieOptions(event),
		maxAge: 60 * 15
	});

	const params = new URLSearchParams({
		client_id: spotifyEnv.clientId,
		response_type: 'code',
		redirect_uri: spotifyEnv.redirectUri,
		scope: SPOTIFY_SCOPE,
		state,
		show_dialog: options.forceAccountPicker === false ? 'false' : 'true'
	});

	return new URL(`${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`);
}

export function clearSpotifyAuthCookies(
	event: Pick<RequestEvent, 'url' | 'cookies'> | { url: URL; cookies: Cookies }
): void {
	const options = cookieOptions(event);
	event.cookies.delete(ACCESS_TOKEN_COOKIE, options);
	event.cookies.delete(REFRESH_TOKEN_COOKIE, options);
	event.cookies.delete(EXPIRES_AT_COOKIE, options);
	event.cookies.delete(OAUTH_STATE_COOKIE, options);
	event.cookies.delete(SCOPE_COOKIE, options);
}

function persistSpotifyTokens(
	event: Pick<RequestEvent, 'url' | 'cookies'>,
	payload: SpotifyTokenResponse
): void {
	const options = cookieOptions(event);
	const expiresAt = Date.now() + Math.max(60, payload.expires_in - 30) * 1000;

	event.cookies.set(ACCESS_TOKEN_COOKIE, payload.access_token, {
		...options,
		maxAge: payload.expires_in
	});

	event.cookies.set(EXPIRES_AT_COOKIE, String(expiresAt), {
		...options,
		maxAge: payload.expires_in
	});

	if (payload.scope) {
		event.cookies.set(SCOPE_COOKIE, payload.scope, {
			...options,
			maxAge: payload.expires_in
		});
	}

	if (payload.refresh_token) {
		event.cookies.set(REFRESH_TOKEN_COOKIE, payload.refresh_token, {
			...options,
			maxAge: 60 * 60 * 24 * 30
		});
	}
}

async function requestSpotifyToken(body: URLSearchParams): Promise<SpotifyTokenResponse> {
	const spotifyEnv = getSpotifyEnv();

	const response = await fetch(SPOTIFY_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Authorization: `Basic ${Buffer.from(`${spotifyEnv.clientId}:${spotifyEnv.clientSecret}`).toString('base64')}`
		},
		body
	});

	if (!response.ok) {
		throw new Error(`Spotify token request failed: ${response.status} ${response.statusText}`);
	}

	return (await response.json()) as SpotifyTokenResponse;
}

export async function exchangeAuthorizationCode(
	event: Pick<RequestEvent, 'url' | 'cookies'>,
	code: string,
	state: string | null
): Promise<void> {
	const expectedState = event.cookies.get(OAUTH_STATE_COOKIE);
	if (!state || !expectedState || state !== expectedState) {
		throw new Error('Spotify authentication state mismatch. Please try again.');
	}

	event.cookies.delete(OAUTH_STATE_COOKIE, cookieOptions(event));

	const payload = await requestSpotifyToken(
		new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: getSpotifyEnv().redirectUri
		})
	);

	if (!hasRequiredScopes(payload.scope)) {
		clearSpotifyAuthCookies(event);
		throw new Error(
			'Spotify did not grant required playlist scopes. Reconnect and approve playlist access permissions.'
		);
	}

	persistSpotifyTokens(event, payload);
}

async function refreshAccessToken(
	event: Pick<RequestEvent, 'url' | 'cookies'>
): Promise<string | null> {
	const refreshToken = event.cookies.get(REFRESH_TOKEN_COOKIE);
	if (!refreshToken) {
		return null;
	}

	try {
		const payload = await requestSpotifyToken(
			new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken
			})
		);

		const grantedScope = payload.scope ?? event.cookies.get(SCOPE_COOKIE) ?? '';
		if (!hasRequiredScopes(grantedScope)) {
			clearSpotifyAuthCookies(event);
			return null;
		}

		persistSpotifyTokens(event, {
			...payload,
			scope: grantedScope
		});
		return payload.access_token;
	} catch {
		clearSpotifyAuthCookies(event);
		return null;
	}
}

export async function getValidSpotifyAccessToken(
	event: Pick<RequestEvent, 'url' | 'cookies'>
): Promise<string | null> {
	const scope = event.cookies.get(SCOPE_COOKIE);
	if (!scope || !hasRequiredScopes(scope)) {
		clearSpotifyAuthCookies(event);
		return null;
	}

	const token = event.cookies.get(ACCESS_TOKEN_COOKIE);
	const expiresAtRaw = event.cookies.get(EXPIRES_AT_COOKIE);
	const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : 0;

	if (token && Number.isFinite(expiresAt) && Date.now() < expiresAt) {
		return token;
	}

	return refreshAccessToken(event);
}

export function hasSpotifySession(cookies: Cookies): boolean {
	return Boolean(cookies.get(REFRESH_TOKEN_COOKIE) || cookies.get(ACCESS_TOKEN_COOKIE));
}

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

async function fetchSpotifyJson<T>(url: string, token: string): Promise<T> {
	let response: Response;
	try {
		response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`
			}
		});
	} catch (error) {
		const detail = getErrorDetails(error);
		const suffix = detail ? ` Details: ${detail}.` : '';
		throw new SpotifyApiError(
			502,
			`Unable to reach Spotify Web API while loading playlist data.${suffix} Check server network connectivity and try again.`
		);
	}

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

		const normalizedPayload = payload as {
			error?: { message?: string; status?: number } | string;
		} | null;

		if (typeof normalizedPayload?.error === 'string') {
			spotifyErrorReason = normalizedPayload.error;
		} else if (normalizedPayload?.error?.message) {
			spotifyErrorReason = normalizedPayload.error.message;
		} else if (errorBody.trim()) {
			spotifyErrorReason = errorBody.trim();
		}
	}

	if (response.status === 401) {
		throw new SpotifyApiError(401, 'Spotify access token expired or invalid.');
	}

	if (response.status === 403) {
		const reason = spotifyErrorReason.toLowerCase();
		const urlForError = (() => {
			try {
				const parsed = new URL(url);
				return `${parsed.pathname}${parsed.search}`;
			} catch {
				return url;
			}
		})();

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
		const authDetail = wwwAuthenticate ? ` www-authenticate: ${wwwAuthenticate}.` : '';
		throw new SpotifyApiError(
			403,
			`Spotify denied playlist access.${detail}${authDetail} Endpoint: ${urlForError}. Spotify sometimes blocks specific playlist types in Web API even when they are visible in the Spotify app. If this is unexpected, reconnect Spotify with account picker and try again.`
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

async function diagnosePlaylist403(playlistId: string, token: string): Promise<string> {
	const headers = {
		Authorization: `Bearer ${token}`
	};

	const details: string[] = [];

	try {
		const metaUrl = `${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=id,name,owner(id),public,collaborative`;
		const metaResponse = await fetch(metaUrl, { headers });
		details.push(`playlist-meta-status=${metaResponse.status}`);
		if (metaResponse.ok) {
			const payload = (await metaResponse.json()) as SpotifyPlaylistMetaResponse;
			details.push(`playlist-public=${String(payload.public)}`);
			details.push(`playlist-collaborative=${String(payload.collaborative)}`);
			if (payload.owner?.id) {
				details.push(`playlist-owner=${payload.owner.id}`);
			}
		}
	} catch (error) {
		const detail = getErrorDetails(error) || 'unknown';
		details.push(`playlist-meta-error=${detail}`);
	}

	try {
		const currentUserPlaylistsUrl = `${SPOTIFY_API_BASE}/me/playlists?limit=50`;
		const playlistsResponse = await fetch(currentUserPlaylistsUrl, { headers });
		details.push(`me-playlists-status=${playlistsResponse.status}`);
		if (playlistsResponse.ok) {
			const payload = (await playlistsResponse.json()) as SpotifyCurrentUserPlaylistsResponse;
			const includesPlaylist = (payload.items ?? []).some(
				(playlist) => playlist?.id === playlistId
			);
			details.push(`playlist-listed-in-me-playlists=${includesPlaylist ? 'yes' : 'no'}`);
		}
	} catch (error) {
		const detail = getErrorDetails(error) || 'unknown';
		details.push(`me-playlists-error=${detail}`);
	}

	return details.join(', ');
}

async function fetchPlaylistMeta(
	playlistId: string,
	token: string
): Promise<SpotifyPlaylistMetaResponse | null> {
	const metaUrl = `${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=id,name,owner(id),public,collaborative`;
	try {
		return await fetchSpotifyJson<SpotifyPlaylistMetaResponse>(metaUrl, token);
	} catch {
		return null;
	}
}

function createPlaylistTracksUrl(playlistId: string): string {
	const params = new URLSearchParams({
		limit: String(SPOTIFY_PLAYLIST_PAGE_LIMIT),
		additional_types: 'track',
		market: 'from_token'
	});
	return `${SPOTIFY_API_BASE}/playlists/${playlistId}/items?${params.toString()}`;
}

export async function getPlaylistTracks(
	event: Pick<RequestEvent, 'url' | 'cookies'>,
	playlistRef: string
): Promise<PlaylistTracksResult> {
	const playlistId = extractPlaylistId(playlistRef);
	let token = await getValidSpotifyAccessToken(event);
	if (!token) {
		throw new Error('Spotify authentication required. Connect Spotify and try again.');
	}

	let nextUrl: string | null = createPlaylistTracksUrl(playlistId);
	const songs: SongCardData[] = [];
	let skippedWithoutSpotifyUrl = 0;
	let hasRetriedWithRefresh = false;

	while (nextUrl) {
		let page: SpotifyPlaylistItemsResponse;

		try {
			page = await fetchSpotifyJson<SpotifyPlaylistItemsResponse>(nextUrl, token);
		} catch (error) {
			if (
				error instanceof SpotifyApiError &&
				(error.status === 401 || error.status === 403) &&
				!hasRetriedWithRefresh
			) {
				hasRetriedWithRefresh = true;
				const refreshedToken = await refreshAccessToken(event);
				if (!refreshedToken) {
					throw new Error('Spotify authentication expired. Reconnect Spotify and try again.');
				}
				token = refreshedToken;
				continue;
			}

			if (error instanceof SpotifyApiError && error.status === 403) {
				const playlistMeta = await fetchPlaylistMeta(playlistId, token);
				const diagnostics = await diagnosePlaylist403(playlistId, token);
				const visibility = playlistMeta
					? `playlist-meta-public=${String(playlistMeta.public)}, playlist-meta-collaborative=${String(playlistMeta.collaborative)}`
					: 'playlist-meta-public=unknown';
				const suffix = diagnostics
					? ` Diagnostics: ${visibility}, ${diagnostics}.`
					: ` Diagnostics: ${visibility}.`;
				throw new Error(`${error.message}${suffix}`);
			}

			throw error;
		}

		hasRetriedWithRefresh = false;
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
				release_date: track.album?.release_date?.trim() || null
			});
		}

		nextUrl = page.next ?? null;
	}

	return {
		songs,
		skippedWithoutSpotifyUrl
	};
}
