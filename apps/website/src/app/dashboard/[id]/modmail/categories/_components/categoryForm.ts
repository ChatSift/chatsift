import { mapApiErrorToFieldErrors, mapIssuesToFieldErrors } from '@/api/formErrors';

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
	return mapIssuesToFieldErrors(issues, CATEGORY_FIELDS);
}

export function mapCategoryApiError(error: unknown, failureVerb: string): CategoryFormErrors {
	return mapApiErrorToFieldErrors(error, {
		fields: CATEGORY_FIELDS,
		fallbackField: 'name',
		entityName: 'category',
		failureVerb,
	});
}
