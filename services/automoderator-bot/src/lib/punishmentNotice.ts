import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorCaseAction, AutomoderatorPunishmentNotices } from '@chatsift/db';

/**
 * Discord's message ceiling. The notice is capped well below this by the API, and the header and reason are
 * capped too, so this only ever bites on a row written before those caps existed -- but a DM the bot cannot
 * send is the one failure mode this feature must not introduce, since the DM is also the punishment notice.
 */
const MESSAGE_LIMIT = 2_000;

/**
 * The actions `automoderator_notice_scope` has a member for. UNMUTE and UNBAN are absent because nothing DMs
 * for them -- and absent from the *enum*, so asking the database about one is not a lookup that returns
 * nothing, it is `invalid input value for enum`. Today no caller can get here with either (both pass
 * `notifyTarget: false`); this is what keeps that from becoming a warning in the logs the day one does.
 */
const NOTICE_ACTIONS = new Set(['WARN', 'MUTE', 'KICK', 'SOFTBAN', 'BAN']);

/**
 * The guild's extra text for this action's DM (#232 P3b), or `null` when it has none.
 *
 * A row for the action itself wins over the guild's `DEFAULT`; they are alternatives, not layers, so a guild
 * putting appeal instructions on `BAN` does not also have to restate whatever its general notice says. Both
 * candidates come back in one query -- there are at most two rows and they share a primary-key prefix.
 */
export async function readPunishmentNotice(guildId: string, action: AutomoderatorCaseAction): Promise<string | null> {
	if (!NOTICE_ACTIONS.has(action as unknown as string)) {
		return null;
	}

	const rows = await getContext().db<Pick<AutomoderatorPunishmentNotices, 'content' | 'scope'>[]>`
		SELECT scope, content FROM automoderator_punishment_notices
		WHERE guild_id = ${guildId} AND scope IN ('DEFAULT', ${action})
	`;

	// Both sides are kanel-branded strings from two different tables, so they are compared as plain strings --
	// the same unbranding every other row-versus-constant comparison in this service does.
	const wanted = action as unknown as string;
	const scopeOf = (row: Pick<AutomoderatorPunishmentNotices, 'scope'>) => row.scope as unknown as string;

	const specific = rows.find((row) => scopeOf(row) === wanted);
	const fallback = rows.find((row) => scopeOf(row) === 'DEFAULT');

	return specific?.content ?? fallback?.content ?? null;
}

/**
 * The DM body, with the guild's notice on the end.
 *
 * The notice read is deliberately best-effort: `notifyTarget` already swallows its own failures because a DM
 * that cannot be delivered must not stop a ban, and the same has to hold one level down. A guild whose notice
 * fails to load gets the plain DM, not no DM.
 */
export async function appendPunishmentNotice(
	body: string,
	guildId: string,
	action: AutomoderatorCaseAction,
	logger: Logger,
): Promise<string> {
	let notice: string | null;

	try {
		notice = await readPunishmentNotice(guildId, action);
	} catch (error) {
		logger.warn({ err: error, guildId, action }, 'could not read the punishment notice -- sending the DM without it');
		return body;
	}

	if (!notice) {
		return body;
	}

	const withNotice = `${body}\n\n${notice}`;
	return withNotice.length > MESSAGE_LIMIT ? withNotice.slice(0, MESSAGE_LIMIT) : withNotice;
}
