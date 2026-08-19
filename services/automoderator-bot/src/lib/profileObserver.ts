import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { withGuildUserLock } from '@chatsift/bot-core';
import { formatCaseUserTag } from '@chatsift/core';
import type {
	APIEmbed,
	Client,
	GatewayGuildMemberAddDispatchData,
	GatewayGuildMemberUpdateDispatchData,
} from '@discordjs/core';
import { GatewayDispatchEvents } from '@discordjs/core';
import { dispatchLog, getLogWebhook, LOG_TYPE } from './guildLog.js';
import type { ProfileChangeKind } from './guildLogFormat.js';
import { buildProfileChangeEmbed } from './guildLogFormat.js';
import type { CachedMemberProfile } from './memberCache.js';
import { cacheMemberProfile, getCachedMemberProfile } from './memberCache.js';
import { featureInvocations } from './metrics.js';

/**
 * The user log (P4, feature 34): nickname, username and display-name changes.
 *
 * Needs the `GuildMembers` intent -- `GUILD_MEMBER_ADD` and `GUILD_MEMBER_UPDATE` are both behind it, and
 * without it this whole module is silently inert.
 *
 * Legacy tracked `username` alone because display names did not exist yet. Post-pomelo the name people actually
 * see is `global_name`, so a rename that only changes that would otherwise go unlogged -- which is the more
 * interesting of the two for a moderator, since it is the one impersonation uses.
 */
const FEATURE = 'profile_log';

function profileOf(
	member: { nick?: string | null | undefined; user: { global_name?: string | null; username: string } },
): CachedMemberProfile {
	return {
		nick: member.nick ?? null,
		username: member.user.username,
		globalName: member.user.global_name ?? null,
	};
}

export function registerProfileObserver(client: Client): void {
	// A join is not itself logged -- Discord's own member list and audit log cover that, and legacy did not log
	// it either. It is recorded so the member's *first* rename has something to diff against, which is the one
	// gap a cache-on-change-only design leaves.
	client.on(GatewayDispatchEvents.GuildMemberAdd, async ({ data }) => {
		try {
			await handleGuildMemberAdd(data);
		} catch (error) {
			getContext().logger.error({ err: error, guildId: data.guild_id }, 'failed to record a joining member');
		}
	});

	client.on(GatewayDispatchEvents.GuildMemberUpdate, async ({ data }) => {
		const logger = getContext().logger.child({ event: 'guildMemberUpdate', guildId: data.guild_id });

		try {
			await handleGuildMemberUpdate(data, logger);
		} catch (error) {
			featureInvocations.inc({ feature: FEATURE, outcome: 'failed' });
			logger.error({ err: error, userId: data.user.id }, 'failed to log a profile change');
		}
	});
}

async function handleGuildMemberAdd(data: GatewayGuildMemberAddDispatchData): Promise<void> {
	if (!data.user || data.user.bot) {
		return;
	}

	const user = data.user;

	// Same lock as the update path, and for the same reason: a member who joins and immediately picks a
	// nickname produces two writes to one key, and the second must not read the state the first is mid-way
	// through replacing.
	await withGuildUserLock(data.guild_id, user.id, async () =>
		cacheMemberProfile(data.guild_id, user.id, profileOf({ nick: data.nick, user })),
	);
}

async function handleGuildMemberUpdate(data: GatewayGuildMemberUpdateDispatchData, logger: Logger): Promise<void> {
	if (data.user.bot) {
		return;
	}

	// The body below is a read-modify-write on one redis key. Two `GUILD_MEMBER_UPDATE`s for the same member
	// arriving together -- a rename and a role change, say -- would otherwise both read the same "before" and
	// log the same previous value twice, losing the intermediate state. Social's XP tracking takes this lock
	// for the identical shape of bug; it is process-local, which is the right scope, since a guild's events
	// only ever reach one replica.
	await withGuildUserLock(data.guild_id, data.user.id, async () => {
		const before = await getCachedMemberProfile(data.guild_id, data.user.id);
		const after = profileOf(data);

		// Written before the diff is even considered, so a change we cannot describe still leaves the next one
		// describable. This is the whole reason a cold cache costs one change rather than all of them.
		await cacheMemberProfile(data.guild_id, data.user.id, after);

		if (!before) {
			featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
			return;
		}

		const user = { id: data.user.id, tag: formatCaseUserTag(data.user), avatar: data.user.avatar };

		const changes: [ProfileChangeKind, string | null, string | null][] = [
			['nickname', before.nick, after.nick],
			['username', before.username, after.username],
			['display name', before.globalName, after.globalName],
		];

		const embeds: APIEmbed[] = changes
			.filter(([, from, to]) => from !== to)
			.map(([kind, from, to]) => buildProfileChangeEmbed({ user, kind, before: from, after: to }));

		// `GUILD_MEMBER_UPDATE` fires for role changes, timeouts, boosting and avatar changes too, none of which
		// this log covers -- so most of them end here having only refreshed the cache.
		if (embeds.length === 0) {
			return;
		}

		// After the diff rather than before it, unlike the message log's: the cache write above has to happen
		// for every member of every guild whether or not anyone is logging, or a guild that turns this on would
		// start with nothing to diff against.
		const webhook = await getLogWebhook(data.guild_id, LOG_TYPE.USER);
		if (!webhook) {
			return;
		}

		// One post carrying every change, rather than one per field: renaming yourself and clearing your
		// nickname in the same edit is one action a member took, and splitting it reads as two.
		await dispatchLog(webhook, { source: 'observer', embeds }, logger);

		featureInvocations.inc({ feature: FEATURE, outcome: 'applied' });
	});
}
