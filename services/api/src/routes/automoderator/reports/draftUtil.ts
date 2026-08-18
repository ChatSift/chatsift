import type { Logger, ReportActor, ReportDraft, SplitDraft } from '@chatsift/backend-core';
import { getContext, getReportDraft, resolveReportDraftToken, splitDraft } from '@chatsift/backend-core';
import type { AutomoderatorGuildSettings } from '@chatsift/db';
import { forbidden, notFound } from '@hapi/boom';
import { apiForGuild } from '../../../util/discordAPI.js';
import { isNotFoundDiscordError } from '../../../util/discordErrors.js';
import type { Me, MeGuild } from '../../../util/me.js';

/**
 * Shared by the two DM-report routes (P3b): the preview the website renders, and the submission it confirms.
 * Both have to answer the same two questions -- "is this really the person who minted this token, and what is
 * in their draft" and "which of their servers may this be filed into" -- and answering them differently in the
 * two places is how a picker ends up offering a guild the submission then refuses.
 */

export interface ResolvedDraft {
	readonly draft: ReportDraft;
	readonly reporter: ReportActor;
	readonly split: SplitDraft;
}

/**
 * Resolves a draft token against the *logged-in session*, not against the token alone.
 *
 * The token names a draft holding private DM content, so it is bound to the Discord account that minted it and
 * re-checked here after OAuth. This is deliberately a different security model from
 * `automoderatorHistoryTokens.ts`, which really is a bearer token -- the resemblance is the trap.
 */
export async function resolveDraftForSession(token: string, me: Me): Promise<ResolvedDraft> {
	const named = await resolveReportDraftToken(token);
	if (!named) {
		throw notFound('this link has expired');
	}

	if (named.userId !== me.id) {
		// 403 rather than 404: a mismatch means the link is real and belongs to somebody else, and quietly
		// pretending it never existed would send the wrong person round the OAuth loop again.
		throw forbidden('this report link belongs to a different account');
	}

	const draft = await getReportDraft(named.userId);
	if (!draft?.messages.length) {
		throw notFound('this draft has expired');
	}

	const split = splitDraft(draft, me.id);
	if (!split) {
		throw notFound('this draft only contains your own messages, so there is nobody to report');
	}

	return {
		draft,
		split,
		reporter: { id: me.id, tag: me.global_name ?? me.username },
	};
}

/**
 * A server the reporter may file this report into.
 */
export interface ReportCandidateGuild {
	icon: string | null;
	id: string;
	name: string;
}

/**
 * The servers a DM report may be filed into: ones the reporter is in, that have AutoModerator, that have
 * turned reporting on, **and** that the reported account is also in.
 *
 * The OAuth `guilds` scope is what makes this cheap -- it is the user-to-guild index a bot process does not
 * have, and the reason the website hop exists at all rather than this being a bot command. The intersection
 * with the bot's own guild list and the settings table costs no Discord calls; only the survivors pay one
 * `GET /guilds/{id}/members/{target}` each, which in practice is a handful.
 *
 * Guilds are dropped silently and the caller's copy is deliberately vague about why one is missing. That
 * vagueness is the mitigation, not sloppiness: it stops the picker doubling as a membership oracle, because
 * the reporter cannot tell "they are not in that server" from "that server isn't accepting reports".
 */
export async function resolveCandidateGuilds(
	me: Me,
	targetId: string,
	logger: Logger,
): Promise<ReportCandidateGuild[]> {
	const installed = me.guilds.filter((guild) => guild.bots.includes('AUTOMODERATOR'));
	if (!installed.length) {
		return [];
	}

	const enabled = await getContext().db<Pick<AutomoderatorGuildSettings, 'guildId'>[]>`
		SELECT guild_id FROM automoderator_guild_settings
		WHERE guild_id IN ${getContext().db(installed.map((guild) => guild.id))}
			AND reports_channel_id IS NOT NULL
	`;

	// Widened to `string`: kanel brands `guild_id` per table, and the ids being compared here come off the
	// OAuth guild list rather than out of that column.
	const enabledIds = new Set<string>(enabled.map((row) => row.guildId));
	const reportable = installed.filter((guild) => enabledIds.has(guild.id));

	const checked = await Promise.all(
		reportable.map(async (guild): Promise<MeGuild | null> => {
			try {
				await apiForGuild('AUTOMODERATOR', guild.id).guilds.getMember(guild.id, targetId);
				return guild;
			} catch (error) {
				if (isNotFoundDiscordError(error)) {
					return null;
				}

				// A guild whose membership lookup failed for any other reason (a rate limit, a 5xx) is dropped from
				// this list rather than failing the whole request: the reporter can still file into the others, and
				// the alternative is one flaky guild costing them the whole draft.
				logger.warn({ err: error, guildId: guild.id }, 'failed to check report target membership');
				return null;
			}
		}),
	);

	return checked
		.filter((guild): guild is MeGuild => guild !== null)
		.map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon }));
}
