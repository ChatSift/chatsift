import { mapApiErrorToFieldErrors, mapIssuesToFieldErrors } from '@/api/formErrors';

export interface InteractionFormData {
	allowTargets: boolean;
	attachmentUrl: string;
	color: string;
	content: string;
	embed: boolean;
	name: string;
	plainContent: string;
}

export type InteractionFormErrors = Partial<Record<keyof InteractionFormData, string>>;

export const INTERACTION_FIELDS = [
	'name',
	'content',
	'color',
	'plainContent',
	'attachmentUrl',
	'embed',
	'allowTargets',
] as const satisfies (keyof InteractionFormData)[];

export function mapInteractionIssues(
	issues: readonly { message: string; path: PropertyKey[] }[],
): InteractionFormErrors {
	return mapIssuesToFieldErrors(issues, INTERACTION_FIELDS);
}

/**
 * Both interaction routes 409 on a duplicate name and 422 on a name Discord itself rejects, neither of which
 * carries a `conflictField` -- so both land on `name` via the fallback, which is where they belong anyway. Same
 * arrangement as `snippetForm.ts`.
 */
export function mapInteractionApiError(error: unknown, failureVerb: string): InteractionFormErrors {
	return mapApiErrorToFieldErrors(error, {
		fields: INTERACTION_FIELDS,
		fallbackField: 'name',
		entityName: 'interaction',
		failureVerb,
	});
}

/**
 * The API's `INTERACTION_NAME_REGEX` is ASCII-only (deliberately narrower than Discord's unicode-aware rule --
 * see `social/schemas.ts`), so this is stricter than `normalizeSnippetName`'s `\p{L}\p{N}` and can't reuse it:
 * normalizing a name to something the schema then rejects would be worse than not normalizing at all.
 */
export function normalizeInteractionName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replaceAll(/\s+/g, '-')
		.replaceAll(/[^\d_a-z-]/g, '')
		.slice(0, 32);
}
