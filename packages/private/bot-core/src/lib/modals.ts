import type { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';

/**
 * Reading values back out of a submitted modal, for the components that might not be there.
 *
 * `ModalInteractionOptionResolver` **throws** when asked for a component the submission doesn't contain, and a
 * component the user left alone can simply be absent — so every optional field in a modal needs this, and every
 * caller that doesn't have it is one blank field away from an unhandled rejection. AMA's question modal works
 * around the same thing by only asking for its upload component when the config that added it is on
 * (`submitQuestion.ts`), which is fine there because the condition is real information; it is not a general
 * answer, because "the user didn't fill it in" has no such condition to test.
 *
 * "Absent", "blank" and "whitespace only" all collapse to `null`: no caller in this codebase has ever wanted to
 * tell them apart, and treating an empty string as a value is how a blank reason ends up on a case.
 */
function readOptional(read: () => string | undefined): string | null {
	let value: string | undefined;

	try {
		value = read();
	} catch {
		return null;
	}

	const trimmed = value?.trim();
	return trimmed?.length ? trimmed : null;
}

/**
 * A text input the user may have left empty, or that may not be in the modal at all.
 */
export function readOptionalTextInput(options: ModalInteractionOptionResolver, customId: string): string | null {
	return readOptional(() => options.getTextInput(customId));
}

/**
 * The first value of a string select the user may not have touched. Single-select only, which is every select
 * this codebase puts in a modal — a multi-select wants the whole array and should read it directly.
 */
export function readOptionalSelectedString(options: ModalInteractionOptionResolver, customId: string): string | null {
	return readOptional(() => options.getSelectedStrings(customId)[0]);
}
