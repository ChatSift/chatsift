import type { CaseActionName, CaseEmbedOptions } from '@chatsift/core';
import { buildCaseEmbed as buildSharedCaseEmbed } from '@chatsift/core';
import type { AutomoderatorCases } from '@chatsift/db';
import type { APIEmbed } from '@discordjs/core';

export { ACTION_PAST_TENSE, LOG_COLORS, formatCaseDuration as formatDuration } from '@chatsift/core';

export function buildCaseEmbed(
	modCase: AutomoderatorCases,
	options: Omit<CaseEmbedOptions, 'reference'> & { reference?: AutomoderatorCases | null } = {},
): APIEmbed {
	return buildSharedCaseEmbed(
		{ ...modCase, actionType: modCase.actionType as unknown as CaseActionName },
		{
			...options,
			reference: options.reference ? { logMessageId: options.reference.logMessageId } : null,
		},
	);
}
