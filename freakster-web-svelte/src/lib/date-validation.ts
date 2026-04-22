const YEAR_PATTERN = /^\d{4}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const FULL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type DateValidationStatus = 'missing' | 'incomplete' | 'invalid' | 'valid';

export function isCalendarDateValid(value: string): boolean {
	if (!FULL_DATE_PATTERN.test(value)) {
		return false;
	}

	const [yearRaw, monthRaw, dayRaw] = value.split('-');
	const year = Number(yearRaw);
	const month = Number(monthRaw);
	const day = Number(dayRaw);

	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
		return false;
	}

	if (month < 1 || month > 12 || day < 1) {
		return false;
	}

	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return day <= daysInMonth;
}

export function classifyReleaseDate(value: string | null | undefined): DateValidationStatus {
	if (value === null || value === undefined) {
		return 'missing';
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return 'missing';
	}

	if (YEAR_PATTERN.test(trimmed)) {
		return 'incomplete';
	}

	if (YEAR_MONTH_PATTERN.test(trimmed)) {
		const [, monthRaw] = trimmed.split('-');
		const month = Number(monthRaw);
		if (Number.isInteger(month) && month >= 1 && month <= 12) {
			return 'incomplete';
		}

		return 'invalid';
	}

	if (isCalendarDateValid(trimmed)) {
		return 'valid';
	}

	return 'invalid';
}
