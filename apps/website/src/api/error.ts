export class APIError extends Error {
	public readonly statusCode: number;

	public readonly error: string;

	public constructor(statusCode: number, error: string, message: string) {
		super(message);
		this.name = 'APIError';
		this.statusCode = statusCode;
		this.error = error;
	}

	/**
	 * 4xx — do not retry
	 */
	public isClientError(): boolean {
		return this.statusCode >= 400 && this.statusCode < 500;
	}
}
