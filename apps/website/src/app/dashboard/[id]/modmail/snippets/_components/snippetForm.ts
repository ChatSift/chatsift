import { APIError } from '@/api/error';

export interface SnippetFormData {
	attachmentFilename: string;
	attachmentUrl: string;
	content: string;
	name: string;
}

export type SnippetFormErrors = Partial<Record<keyof SnippetFormData, string>>;

export const SNIPPET_FIELDS = [
	'name',
	'content',
	'attachmentUrl',
	'attachmentFilename',
] as const satisfies (keyof SnippetFormData)[];

export function mapSnippetIssues(issues: readonly { message: string; path: PropertyKey[] }[]): SnippetFormErrors {
	const errors: SnippetFormErrors = {};

	for (const issue of issues) {
		const [first] = issue.path;
		if (typeof first === 'string' && (SNIPPET_FIELDS as readonly string[]).includes(first)) {
			errors[first as keyof SnippetFormData] ??= issue.message;
		}
	}

	return errors;
}

/**
 * Maps an API error from a create/update snippet request to field-level form errors. `failureVerb` (e.g.
 * "create"/"update") only affects the generic fallback message -- the field-error extraction itself is
 * identical between the two routes.
 */
export function mapSnippetApiError(error: unknown, failureVerb: string): SnippetFormErrors {
	if (error instanceof APIError) {
		if (error.statusCode === 409 || error.statusCode === 422) {
			// Neither snippet route currently sets `conflictField` (both 409-duplicate-name and
			// 422-invalid-command-name are name-only today) -- checked anyway, matching the category form's
			// pattern, so this keeps working without a frontend change if that ever changes server-side.
			const field = (SNIPPET_FIELDS as readonly string[]).includes(error.conflictField ?? '')
				? (error.conflictField as keyof SnippetFormData)
				: 'name';
			return { [field]: error.message };
		}

		if (error.statusCode === 400) {
			return Object.fromEntries(
				SNIPPET_FIELDS.map((field) => [field, error.fieldError(field)]).filter(([, message]) => message),
			);
		}

		return { name: error.message || `Failed to ${failureVerb} snippet` };
	}

	console.error(`Failed to ${failureVerb} snippet`, error);
	return { name: `Failed to ${failureVerb} snippet` };
}
