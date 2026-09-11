import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { collectModal, readOptionalTextInput } from '@chatsift/bot-core';
import { APPEAL_DECISION_REASON_MAX_LENGTH } from '@chatsift/core';
import type { APIMessageComponentInteraction, APIModalInteractionResponseCallbackData } from '@discordjs/core';
import { ComponentType, MessageFlags, TextInputStyle } from '@discordjs/core';
import { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';
import { describeUndecidable, refreshAppealCard, resolveAppealInteraction } from './appealComponents.js';
import { runAppealDecision } from './appealDecisions.js';

const REASON_INPUT_ID = 'reason';

const MODAL_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Both denial buttons, which differ in exactly two places: who ends up reading the reason, and whether the
 * appellant is ever told at all (decision 6).
 *
 * They stay two registered handlers rather than one with a flag in the custom id, because `bot-core`'s registry
 * splits an id into `name:state` and routes on the name -- a third segment would be a second parser living
 * outside that contract.
 */
export async function handleAppealDenial(
	interaction: APIMessageComponentInteraction,
	appealId: string | undefined,
	silent: boolean,
	logger: Logger,
): Promise<void> {
	const resolved = await resolveAppealInteraction(interaction, appealId, logger);
	if (!resolved) {
		return;
	}

	const api = getContext().service.client.api;

	const blocked = describeUndecidable(resolved.appeal);
	if (blocked) {
		await api.interactions.reply(interaction.id, interaction.token, {
			content: blocked,
			flags: MessageFlags.Ephemeral,
		});

		// Rewritten anyway, so the stale card the click came from picks up its disabled buttons.
		await refreshAppealCard(resolved.appeal, logger);
		return;
	}

	const modalId = nanoid();
	await api.interactions.createModal(interaction.id, interaction.token, buildModal(modalId, silent));

	let modal;
	try {
		modal = await collectModal(modalId, MODAL_TIMEOUT_MS);
	} catch {
		// Routine: a moderator who closed the modal needs no confirmation that nothing happened.
		return;
	}

	await api.interactions.defer(modal.id, modal.token, { flags: MessageFlags.Ephemeral });

	const reason = readOptionalTextInput(new ModalInteractionOptionResolver(modal), REASON_INPUT_ID);

	// Deliberately no re-read of the appeal here, even though this modal may have sat open for five minutes:
	// `applyAppealDecision`'s compare-and-swap is what settles a race, and it phrases the loss better than a
	// second staleness check could ("someone else decided this first" rather than a bare refusal).
	const line = await runAppealDecision(
		{
			appeal: resolved.appeal,
			decision: silent ? 'denied_silent' : 'denied',
			member: resolved.member,
			reason,
		},
		logger,
	);

	await api.interactions.editReply(modal.application_id, modal.token, { content: line });
}

function buildModal(modalId: string, silent: boolean): APIModalInteractionResponseCallbackData {
	return {
		custom_id: modalId,
		title: silent ? 'Deny silently' : 'Deny this appeal',
		components: [
			{
				type: ComponentType.Label,
				label: silent ? 'Note for your team' : 'Reason',
				description: silent
					? 'Only moderators ever see this. The appellant is told nothing at all.'
					: 'The appellant will be shown this, so write it for them.',
				component: {
					type: ComponentType.TextInput,
					custom_id: REASON_INPUT_ID,
					style: TextInputStyle.Paragraph,
					// Required on an ordinary denial because it is the entire message the appellant receives, and a
					// denial with no reason is the thing every appeal system is criticised for. A silent denial has no
					// reader who is waiting on it, so an empty box there is a legitimate "no comment".
					required: !silent,
					max_length: APPEAL_DECISION_REASON_MAX_LENGTH,
				},
			},
		],
	};
}
