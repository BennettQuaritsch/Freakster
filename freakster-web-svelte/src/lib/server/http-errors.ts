import { json } from '@sveltejs/kit';

export class AppHttpError extends Error {
	status: number;
	code?: string;

	constructor(status: number, message: string, code?: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

export function badRequest(message: string, code?: string): never {
	throw new AppHttpError(400, message, code);
}

export function unauthorized(message: string, code?: string): never {
	throw new AppHttpError(401, message, code);
}

export function forbidden(message: string, code?: string): never {
	throw new AppHttpError(403, message, code);
}

export function notFound(message: string, code?: string): never {
	throw new AppHttpError(404, message, code);
}

export function toErrorResponse(error: unknown, fallbackMessage: string) {
	if (error instanceof AppHttpError) {
		return json({ error: error.message, code: error.code }, { status: error.status });
	}

	const message = error instanceof Error ? error.message : fallbackMessage;
	return json({ error: message }, { status: 500 });
}
