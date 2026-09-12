import { getContext } from '@chatsift/backend-core';
import type { ModmailInstanceInterest } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { fetchGuildSummary } from '../../../util/guildSummary.js';
import { resolveUserBestEffort } from '../threads/util.js';

export interface ModmailInstanceInterestGuild {
	/**
	 * Whether ModMail can still see this guild at all. `false` means Discord answered the lookup with a
	 * 403/404 -- the bot was removed, or the guild is gone -- and it is the *only* honest reading of the three
	 * nulls below, which the dashboard would otherwise have to guess at: a server with no icon, no vanity URL
	 * and no members looks identical to one nobody can read. A dead lead is worth as much to the operator as a
	 * live one, so it is labelled rather than dropped.
	 */
	botPresent: boolean;
	iconUrl: string | null;
	id: string;
	/**
	 * Approximate member count, `null` whenever the bot can no longer see the guild -- there is no snapshot in
	 * the row to fall back on the way `name` has one, and a made-up size would be worse than none.
	 */
	memberCount: number | null;
	/**
	 * The guild's name right now, falling back to the click-time snapshot in the row when the bot can no
	 * longer see the guild -- i.e. whenever `botPresent` is `false`, which is what the dashboard labels the
	 * name with rather than passing a stale one off as current.
	 */
	name: string;
	vanityUrlCode: string | null;
}

export interface ModmailInstanceInterestLead {
	createdAt: Date;
	guild: ModmailInstanceInterestGuild;
	/**
	 * Bare snowflake if Discord no longer knows the account; the id is still readable off it either way.
	 */
	user: APIUser | Snowflake;
}

export type ListModmailInstanceInterestResult = ModmailInstanceInterestLead[];

/**
 * Every guild that has raised its hand for a custom ModMail instance (#216), newest first, for `/admin`.
 * Global-admin only and global rather than guild-scoped: it is the operator's lead list, and the whole point
 * is seeing guilds they have no relationship with yet.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/modmail/instance-interest',
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: true,
	}),
	async handler(req): Promise<ListModmailInstanceInterestResult> {
		const rows = await getContext().db<ModmailInstanceInterest[]>`
			SELECT * FROM modmail_instance_interest ORDER BY created_at DESC
		`;

		// Unbounded `Promise.all` is fine at this table's scale (one row per interested guild, ever), and
		// neither lookup goes to Discord in the common case: user resolution is cache-first and de-duped in
		// flight process-wide, and the guild summary is a 5-minute redis cache shared with every other reader.
		return Promise.all(
			rows.map(async (row) => {
				const [user, summary] = await Promise.all([
					resolveUserBestEffort(row.guildId, row.userId, req.logger),
					fetchGuildSummary(row.guildId, 'MODMAIL'),
				]);

				return {
					user,
					guild: {
						id: row.guildId as string,
						name: summary?.name ?? row.guildName,
						botPresent: summary !== null,
						iconUrl: summary?.iconUrl ?? null,
						vanityUrlCode: summary?.vanityUrlCode ?? null,
						memberCount: summary?.approximateMemberCount ?? null,
					},
					createdAt: row.createdAt,
				};
			}),
		);
	},
});
