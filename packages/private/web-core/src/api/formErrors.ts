import { APIError } from './error';

/**
 * Maps zod `safeParse` issues to field-level form errors, keeping only the first message per field and only for
 * fields the caller's form actually has (any other path -- nested objects/arrays this form doesn't render its
 * own field for -- is dropped rather than surfaced somewhere misleading).
 */
export function mapIssuesToFieldErrors<TField extends string>(
	issues: readonly { message: string; path: PropertyKey[] }[],
	fields: readonly TField[],
): Partial<Record<TField, string>> {
	const errors: Partial<Record<TField, string>> = {};

	for (const issue of issues) {
		const [first] = issue.path;
		if (typeof first === 'string' && (fields as readonly string[]).includes(first)) {
			errors[first as TField] ??= issue.message;
		}
	}

	return errors;
}

export interface MapApiErrorOptions<TField extends string> {
	/**
	 * What to call the entity in the generic fallback message, e.g. "category", "snippet".
	 */
	readonly entityName: string;
	/**
	 * e.g. "create"/"update" -- combined with `entityName` for the generic fallback message.
	 */
	readonly failureVerb: string;
	/**
	 * Field to attribute an error to when nothing more specific applies (typically the entity's "name" field).
	 */
	readonly fallbackField: TField;
	readonly fields: readonly TField[];
}

/**
 * Maps an API error from a create/update request to field-level form errors, shared by any dashboard form
 * following the same backend conventions:
 *
 * 1. A `conflictField`-tagged domain error (a 409, or a 400 a route throws for a business-rule violation like
 *    exceeding a guild-wide limit) takes priority and is attributed to that field.
 * 2. Otherwise, a plain 400's per-field `validationErrors` tree is checked for each of `fields`.
 * 3. Otherwise (including a 409/422 that never set `conflictField`, or `validationErrors` not covering any of
 *    `fields`), falls back to a generic message on `fallbackField` -- never returns an empty object, which would
 *    leave the user with no feedback at all.
 */
export function mapApiErrorToFieldErrors<TField extends string>(
	error: unknown,
	{ fields, fallbackField, entityName, failureVerb }: MapApiErrorOptions<TField>,
): Partial<Record<TField, string>> {
	const genericMessage = `Failed to ${failureVerb} ${entityName}`;

	if (!(error instanceof APIError)) {
		console.error(genericMessage, error);
		return { [fallbackField]: genericMessage } as Partial<Record<TField, string>>;
	}

	if (error.conflictField) {
		const field = (fields as readonly string[]).includes(error.conflictField)
			? (error.conflictField as TField)
			: fallbackField;
		return { [field]: error.message } as Partial<Record<TField, string>>;
	}

	if (error.statusCode === 400) {
		const fieldErrors = Object.fromEntries(
			fields.map((field) => [field, error.fieldError(field)]).filter(([, message]) => message),
		) as Partial<Record<TField, string>>;

		if (Object.keys(fieldErrors).length > 0) {
			return fieldErrors;
		}
	}

	return { [fallbackField]: error.message || genericMessage } as Partial<Record<TField, string>>;
}
