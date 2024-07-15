import type { CaseWithLogMessage, IDatabase } from '@automoderator/core';
import { ApplicationCommandOptionType, type APIApplicationCommandOption } from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { ActionKind, HandlerStep, type InteractionHandler as CoralInteractionHandler } from 'coral-command';

export const REFERENCES_OPTION = {
	name: 'references',
	description: 'References to other case IDs (comma seperated)',
	type: ApplicationCommandOptionType.String,
	required: false,
} as const satisfies APIApplicationCommandOption;

export async function* verifyValidCaseReferences(
	options: InteractionOptionResolver,
	database: IDatabase,
): CoralInteractionHandler<CaseWithLogMessage[]> {
	const references =
		options
			.getString('references')
			?.split(',')
			.map((ref) => ref.trim()) ?? null;

	if (!references) {
		return [];
	}

	const numbers = references.map(Number);
	const invalidNumIndex = numbers.findIndex((num) => Number.isNaN(num));

	if (invalidNumIndex !== -1) {
		yield* HandlerStep.from(
			{
				action: ActionKind.Reply,
				options: {
					content: `Reference case ID "${references[invalidNumIndex]}" is not a valid number.`,
				},
			},
			true,
		);
	}

	const cases = await database.getModCaseBulk(numbers);

	if (cases.length !== references.length) {
		const set = new Set(cases.map((cs) => cs.id));

		const invalid = numbers.filter((num) => !set.has(num));

		yield* HandlerStep.from(
			{
				action: ActionKind.Reply,
				options: {
					content: `Reference ID(s) ${invalid.join(', ')} do not exist.`,
				},
			},
			true,
		);
	}

	return cases;
}
