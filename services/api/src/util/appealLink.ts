import { getContext } from '@chatsift/backend-core';

/**
 * Where an appellant lands for one guild (#232 P3b): `unban.app/g/<guildId>`.
 *
 * The guild id rather than an invite code, even though `unban.app/<inviteCode>` resolves too (decision 12).
 * The invite route exists for a link somebody already has in hand; this one is the link a guild *publishes*,
 * and an invite is the wrong identifier for that -- invites expire, get revoked, and are per-channel, so a ban
 * DM sent today would be a dead link the week the guild rotates its invite.
 */
export function buildAppealLink(guildId: string): string {
	return `${getContext().APPEALS_FRONTEND_URL}/g/${guildId}`;
}

/**
 * The same link, but `null` for a guild that does not accept appeals.
 *
 * "Accepts appeals" is the `appeals_settings` row existing and nothing else -- the same predicate
 * `evaluateAppealEligibility` answers `NOT_CONFIGURED` from. Do not relax it to "the Appeals bot is in the
 * guild": handing somebody a link that lands on "this server is not accepting appeals" is worse than handing
 * them no link, because it reads as the guild having rejected them before they typed anything.
 */
export async function readAppealLink(guildId: string): Promise<string | null> {
	const [settings] = await getContext().db<{ guildId: string }[]>`
		SELECT guild_id FROM appeals_settings WHERE guild_id = ${guildId}
	`;

	return settings ? buildAppealLink(guildId) : null;
}
