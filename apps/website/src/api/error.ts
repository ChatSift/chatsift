/**
 * Mirrors zod v4's `treeifyError()` output shape (see `services/api/src/util/sendBoom.ts`, which spreads it
 * into the JSON body of any 400 raised from failed body/query/params validation in `core/server.ts`). `items`
 * covers array-schema fields (e.g. `prompt_raw.embeds`); `properties` covers object fields.
 */
export interface ZodErrorTree {
	readonly errors: string[];
	readonly items: ZodErrorTree[] | undefined;
	readonly properties: Record<string, ZodErrorTree> | undefined;
}

export class APIError extends Error {
	public readonly statusCode: number;

	public readonly error: string;

	/**
	 * Full validation tree, present only on a 400 raised by `mountRoute`'s zod validation step. `undefined` for
	 * every other error (domain errors like "not found", auth failures, 5xxs, ...).
	 */
	public readonly validationErrors: ZodErrorTree | undefined;

	public constructor(statusCode: number, error: string, message: string, validationErrors?: ZodErrorTree) {
		super(message);
		this.name = 'APIError';
		this.statusCode = statusCode;
		this.error = error;
		this.validationErrors = validationErrors;
	}

	/**
	 * 4xx — do not retry
	 */
	public isClientError(): boolean {
		return this.statusCode >= 400 && this.statusCode < 500;
	}

	/**
	 * First validation message at a (possibly nested) field path, e.g. `error.fieldError('prompt', 'description')`
	 * for an object field, or `error.fieldError('prompt_raw', 'embeds', 0)` for an array index. `undefined` if
	 * this wasn't a validation error, or the given path had no error.
	 */
	public fieldError(...path: (number | string)[]): string | undefined {
		let node: ZodErrorTree | undefined = this.validationErrors;
		for (const key of path) {
			if (!node) {
				return undefined;
			}

			node = typeof key === 'number' ? node.items?.[key] : node.properties?.[key];
		}

		return node?.errors[0];
	}
}
