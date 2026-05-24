import type { DateValidationStatus } from '$lib/date-validation';
import type { SongCardData } from '$lib/types/song-card';

export type UiPhase = 'idle' | 'loading' | 'review' | 'error';

export type EditableSong = SongCardData & {
	rowId: string;
};

export type DateStatusMeta = {
	label: string;
	dot: string;
	text: string;
	inputBorder: string;
};

export const POLL_INTERVAL_MS = 1200;

export const SPOTIFY_PLAYLIST_PATTERN =
	/^(?:https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/[A-Za-z0-9]+(?:[?#].*)?|spotify:playlist:[A-Za-z0-9]+|[A-Za-z0-9]{22})$/;

export const DATE_STATUS_META: Record<DateValidationStatus, DateStatusMeta> = {
	missing: {
		label: 'Missing',
		dot: 'bg-status-warning',
		text: 'text-status-warning',
		inputBorder: 'border-status-warning/60 focus:border-status-warning'
	},
	incomplete: {
		label: 'Incomplete',
		dot: 'bg-status-caution',
		text: 'text-status-caution',
		inputBorder: 'border-status-caution/60 focus:border-status-caution'
	},
	invalid: {
		label: 'Invalid',
		dot: 'bg-status-error',
		text: 'text-status-error',
		inputBorder: 'border-status-error/70 focus:border-status-error'
	},
	valid: {
		label: 'Valid',
		dot: 'bg-status-success',
		text: 'text-status-success',
		inputBorder: 'border-border-muted focus:border-primary'
	}
};
