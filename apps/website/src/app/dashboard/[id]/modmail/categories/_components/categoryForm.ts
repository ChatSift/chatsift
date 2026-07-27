import { APIError } from '@/api/error';

export interface CategoryFormData {
	description: string;
	emoji: string;
	forumTagId: string;
	greetingMessage: string;
	maxConcurrentThreads: string;
	name: string;
}

export type CategoryFormErrors = Partial<Record<keyof CategoryFormData, string>>;

export const CATEGORY_FIELDS = [
	'name',
	'emoji',
	'description',
	'greetingMessage',
	'forumTagId',
	'maxConcurrentThreads',
] as const satisfies (keyof CategoryFormData)[];

export function mapCategoryIssues(issues: readonly { message: string; path: PropertyKey[] }[]): CategoryFormErrors {
	const errors: CategoryFormErrors = {};

	for (const issue of issues) {
		const [first] = issue.path;
		if (typeof first === 'string' && (CATEGORY_FIELDS as readonly string[]).includes(first)) {
			errors[first as keyof CategoryFormData] ??= issue.message;
		}
	}

	return errors;
}

/**
 * Maps an API error from a create/update category request to field-level form errors. `failureVerb` (e.g.
 * "create"/"update") only affects the generic fallback message -- the field-error extraction itself is
 * identical between the two routes.
 */
export function mapCategoryApiError(error: unknown, failureVerb: string): CategoryFormErrors {
	if (error instanceof APIError) {
		if (error.conflictField) {
			// `conflictField` is a structured indicator the API attaches to a domain error outside plain zod
			// validation -- either a 409 (duplicate name, duplicate forum tag) or the 400 this route throws when
			// `maxConcurrentThreads` exceeds the guild's general limit (see createCategory.ts/updateCategory.ts/
			// sendBoom.ts). Checked before the zod-validation branch below since those errors carry no
			// `validationErrors` tree for `fieldError` to read. Falls back to `name` only as defense-in-depth
			// against a future conflict this route hasn't set one for.
			const field = (CATEGORY_FIELDS as readonly string[]).includes(error.conflictField)
				? (error.conflictField as keyof CategoryFormData)
				: 'name';
			return { [field]: error.message };
		}

		if (error.statusCode === 400) {
			return Object.fromEntries(
				CATEGORY_FIELDS.map((field) => [field, error.fieldError(field)]).filter(([, message]) => message),
			);
		}

		return { name: error.message || `Failed to ${failureVerb} category` };
	}

	console.error(`Failed to ${failureVerb} category`, error);
	return { name: `Failed to ${failureVerb} category` };
}
