/**
 * Mirrors zod v4's `treeifyError()` output shape (see `services/api/src/util/sendBoom.ts`, which spreads it
 * into the JSON body of any 400 raised from failed body/query/params validation in `core/server.ts`).
 */
export interface ZodFieldErrorNode {
	readonly errors: string[];
	readonly properties?: Record<string, ZodFieldErrorNode>;
}

export class APIError extends Error {
	public readonly statusCode: number;

	public readonly error: string;

	/**
	 * Per-field validation detail, present only on a 400 raised by `mountRoute`'s zod validation step. `undefined`
	 * for every other error (domain errors like "not found", auth failures, 5xxs, ...).
	 */
	public readonly fieldErrors: Record<string, ZodFieldErrorNode> | undefined;

	public constructor(
		statusCode: number,
		error: string,
		message: string,
		fieldErrors?: Record<string, ZodFieldErrorNode>,
	) {
		super(message);
		this.name = 'APIError';
		this.statusCode = statusCode;
		this.error = error;
		this.fieldErrors = fieldErrors;
	}

	/**
	 * 4xx — do not retry
	 */
	public isClientError(): boolean {
		return this.statusCode >= 400 && this.statusCode < 500;
	}

	/**
	 * First validation message for a (possibly nested) field, e.g. `error.fieldError('prompt', 'description')`.
	 * `undefined` if this wasn't a validation error, or the given path had no error.
	 */
	public fieldError(...path: string[]): string | undefined {
		let node: ZodFieldErrorNode | undefined = this.fieldErrors && { errors: [], properties: this.fieldErrors };
		for (const key of path) {
			node = node?.properties?.[key];
			if (!node) {
				return undefined;
			}
		}

		return node?.errors[0];
	}
}
