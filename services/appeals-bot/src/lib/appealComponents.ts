import type { Logger } from '@chatsift/backend-core';
import { APPEAL_STATUS, getAppeal, getContext } from '@chatsift/backend-core';
import { memberHasPermission } from '@chatsift/core';
import type { Appeals } from '@chatsift/db';
import type { APIInteractionGuildMember, APIMessageComponentInteraction } from '@discordjs/core';
import { MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { syncAppealCard } from './appealCard.js';

/**
 * A resolved, authorized card interaction. All three buttons need the same three things -- the appeal, that it
 * belongs to this guild, and that the clicker may decide it -- and getting any of them wrong is a security bug
 * rather than a cosmetic one, hence one place that does all three.
 */
export interface ResolvedAppealInteraction {
	readonly appeal: Appeals;
	readonly member: APIInteractionGuildMember;
}

/**
 * Ban Members, because approving an appeal performs a real unban. Deliberately stricter than the report card's
 * Timeout Members floor: the card has no read-only affordance to gate separately, every button on it is a
 * decision, and a moderator who could not lift the ban by hand should not be able to lift it through here.
 */
const CARD_PERMISSION = PermissionFlagsBits.BanMembers;

/**
 * Re-exported as a predicate rather than the raw bitfield, so the one place that re-checks it (the deny modal,
 * five minutes after the click) cannot drift from the one that checks it first.
 */
export function mayDecideAppeals(member: APIInteractionGuildMember): boolean {
	return memberHasPermission(member, CARD_PERMISSION);
}

export const MISSING_PERMISSION_MESSAGE = 'You need the Ban Members permission to decide appeals.';

export async function resolveAppealInteraction(
	interaction: APIMessageComponentInteraction,
	appealId: string | undefined,
	logger: Logger,
): Promise<ResolvedAppealInteraction | null> {
	const api = getContext().service.client.api;

	const reply = async (content: string) => {
		await api.interactions.reply(interaction.id, interaction.token, { content, flags: MessageFlags.Ephemeral });
	};

	if (!interaction.guild_id || !interaction.member) {
		await reply('This can only be used in a server.');
		return null;
	}

	const parsed = Number(appealId);
	if (!appealId || !Number.isSafeInteger(parsed)) {
		logger.warn({ customId: interaction.data.custom_id }, 'appeal component carried no usable appeal id');
		await reply('I could not work out which appeal that button belongs to.');
		return null;
	}

	const appeal = await getAppeal(parsed);

	// Guild-checked as well as found: appeal ids are a global sequence, so without this a card forwarded into
	// another server would decide the original guild's appeal.
	if (appeal?.guildId !== interaction.guild_id) {
		await reply('That appeal no longer exists.');
		return null;
	}

	if (!mayDecideAppeals(interaction.member)) {
		await reply(MISSING_PERMISSION_MESSAGE);
		return null;
	}

	return { appeal, member: interaction.member };
}

/**
 * Why this appeal cannot be decided, or `null` when it can.
 *
 * The buttons render disabled once an appeal is decided, and that is not enough on its own: a card nobody has
 * clicked since somebody else decided it still carries live ones. Every decision is terminal -- there is no
 * reopening, because the appellant has already been told (or deliberately not told) the answer.
 */
export function describeUndecidable(appeal: Appeals): string | null {
	if (appeal.status === APPEAL_STATUS.PENDING) {
		return null;
	}

	if (appeal.status === APPEAL_STATUS.WITHDRAWN) {
		return 'The appellant withdrew this appeal.';
	}

	return 'This appeal has already been decided.';
}

/**
 * Rewrites the card for an appeal whose row has just changed.
 *
 * Guarded here as well as inside `syncAppealCard`, because the reads that function starts with happen before
 * its own `try` is entered from the caller's point of view: every handler awaits this after it has already
 * committed the decision and acknowledged the interaction, so a throw escaping here buys nothing but a
 * rejection logged as an unhandled listener error -- which `registerFatalErrorHandlers` treats as fatal.
 */
export async function refreshAppealCard(appeal: Appeals, logger: Logger): Promise<void> {
	try {
		await syncAppealCard(appeal, logger);
	} catch (error) {
		logger.error({ err: error, guildId: appeal.guildId, appealId: appeal.id }, 'failed to refresh an appeal card');
	}
}
