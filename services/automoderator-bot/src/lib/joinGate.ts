import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { snowflakeTimestampMs } from '@chatsift/core';
import type { AutomoderatorGuildSettings } from '@chatsift/db';
import type { Client, GatewayGuildMemberAddDispatchData } from '@discordjs/core';
import { GatewayDispatchEvents } from '@discordjs/core';
import { CASE_ACTION } from './caseActions.js';
import { formatDuration } from './caseFormat.js';
import { actorFromUser } from './cases.js';
import { featureInvocations } from './metrics.js';
import { applyModerationAction } from './moderation.js';

/**
 * The join gate (P6, feature 13): an account younger than the guild's `min_join_age_seconds` is kicked the
 * moment it joins.
 *
 * Rides on `GUILD_MEMBER_ADD`, which `profileObserver.ts` already subscribes to -- so this costs the same
 * privileged `GuildMembers` intent the profile log already pays for, and nothing new.
 *
 * **A kick, not a ban**, exactly as legacy did it: the account is not accused of anything, it is merely too new
 * to be here yet, and the whole point is that it can come back once it is old enough.
 */
const FEATURE = 'join_gate';

type JoinGateSettings = Pick<AutomoderatorGuildSettings, 'minJoinAgeSeconds'>;

export function registerJoinGate(client: Client): void {
	client.on(GatewayDispatchEvents.GuildMemberAdd, async ({ data }) => {
		const logger = getContext().logger.child({ event: 'guildMemberAdd', guildId: data.guild_id });

		try {
			await handleGuildMemberAdd(data, logger);
		} catch (error) {
			featureInvocations.inc({ feature: FEATURE, outcome: 'failed' });
			logger.error({ err: error, userId: data.user?.id }, 'the join gate failed to turn an account away');
		}
	});
}

/**
 * Whether an account is too new for this guild. Split out and pure so the arithmetic -- which is the whole
 * feature -- is testable without a gateway.
 *
 * `null` settings and a gate of `null` are both "off", and are answered `false` rather than being left for the
 * caller to check twice.
 */
export function isUnderMinJoinAge(userId: string, minJoinAgeSeconds: number | null, now = Date.now()): boolean {
	if (minJoinAgeSeconds === null) {
		return false;
	}

	return now - snowflakeTimestampMs(userId) < minJoinAgeSeconds * 1_000;
}

async function handleGuildMemberAdd(data: GatewayGuildMemberAddDispatchData, logger: Logger): Promise<void> {
	// Bots are added by somebody who holds Manage Server, so their account age says nothing about whether they
	// belong here. Legacy skipped them too.
	if (!data.user || data.user.bot) {
		return;
	}

	const user = data.user;

	const [settings] = await getContext().db<JoinGateSettings[]>`
		SELECT min_join_age_seconds FROM automoderator_guild_settings WHERE guild_id = ${data.guild_id}
	`;

	// Nothing counted for a guild that has never turned this on: the counter answers "is the gate working", and
	// every join in every guild landing in `skipped` would drown the guilds where it is actually running.
	if (!settings?.minJoinAgeSeconds) {
		return;
	}

	if (!isUnderMinJoinAge(user.id, settings.minJoinAgeSeconds)) {
		featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
		return;
	}

	const result = await applyModerationAction(
		{
			action: CASE_ACTION.KICK,
			guildId: data.guild_id,
			target: actorFromUser(user),
			// Nobody authored this. A case attributed to whoever configured the gate would claim they were online
			// kicking people one at a time, which is exactly what a gate exists to avoid.
			mod: null,
			reason: `Account is newer than this server's minimum of ${formatDuration(settings.minJoinAgeSeconds * 1_000)}`,
			source: 'gate',
			// **No DM.** The one time this feature matters is a raid, and a DM is a second REST call per join on
			// top of the kick -- against accounts that overwhelmingly have DMs closed anyway. Legacy sent none
			// either. The member sees the server's own "you were removed" state, and the case says why.
			notifyTarget: false,
			// `GUILD_MEMBER_ADD` is replayed when a shard resumes, and a replayed join would otherwise kick and
			// file a second time. Keyed on the join rather than the member, so an account that is kicked, waits,
			// and rejoins while still too young is a genuinely new case.
			idempotencyKey: `join-gate:${user.id}:${data.joined_at}`,
		},
		logger,
	);

	// A `GUILD_MEMBER_ADD` replayed after a shard resume finds its case already filed and kicks nobody, so
	// counting it as `applied` would add a kick that never happened to the count on every reconnect.
	featureInvocations.inc({ feature: FEATURE, outcome: result.deduplicated ? 'skipped' : 'applied' });
}
