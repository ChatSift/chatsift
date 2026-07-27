import { mapApiErrorToFieldErrors, mapIssuesToFieldErrors } from '@/api/formErrors';

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
	return mapIssuesToFieldErrors(issues, SNIPPET_FIELDS);
}

/**
 * Neither snippet route currently sets `conflictField` on its 409 (duplicate name)/422 (invalid Discord command
 * name) errors -- both are name-only today. `mapApiErrorToFieldErrors` checks `conflictField` unconditionally
 * regardless of status code, so this still degrades correctly to a `name` error for those cases now, and picks
 * up a real field automatically if a future snippet route ever sets one.
 */
export function mapSnippetApiError(error: unknown, failureVerb: string): SnippetFormErrors {
	return mapApiErrorToFieldErrors(error, {
		fields: SNIPPET_FIELDS,
		fallbackField: 'name',
		entityName: 'snippet',
		failureVerb,
	});
}
