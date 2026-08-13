import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { withGuildUserLock } from '@chatsift/bot-core';
import { calculateUserLevel } from '@chatsift/core';
import type { SocialChannels, SocialGuildSettings, SocialRewards, SocialRoles, SocialUsers } from '@chatsift/db';
import type { GatewayMessageCreateDispatchData } from '@discordjs/core';
import { getRolePositions, resolveChannelChain } from './discordCache.js';
import { isEligibleForXp } from './eligibility.js';
import { broadcastLeaderboardChange } from './leaderboardBroadcast.js';
import { sendLevelUpNotification } from './notifications.js';
import { applyRewardRoles, computeRewardRoleDiff } from './rewards.js';

/**
 * The leveling engine (#343 P3) -- the port of `ChatSift/Social`'s `events/tracking/messageCreate.ts`.
 *
 * Gate order is preserved from legacy, because it's what keeps the common case cheap: a guild that has never
 * configured Social costs exactly one primary-key lookup per message and nothing else.
 */

/**
 * A guild is inert until all three of these are set. Legacy treated the trio as its "is this guild configured at
 * all" flag and `social_guild_settings` keeps them nullable specifically to preserve that state (a row can exist
 * because someone set a notification message without ever switching tracking on).
 */
type ConfiguredSettings = SocialGuildSettings & {
	requiredMessages: number;
	requiredMessagesTimespan: number;
	xpGain: number;
};

function isConfigured(settings: SocialGuildSettings): settings is ConfiguredSettings {
	return settings.requiredMessages !== null && settings.requiredMessagesTimespan !== null && settings.xpGain !== null;
}

/**
 * Resolves the message's channel against `social_channels`, walking the channel itself, then its parent category,
 * then -- for a thread -- the thread parent's own parent.
 *
 * **Deliberate fix over legacy:** its Prisma `findFirst` matched any of the three ids with an `OR` and took
 * whichever row the database happened to return, so a channel with its own row and a configured parent category
 * resolved nondeterministically. Here the chain is ordered most-specific-first and the first configured hop
 * wins, which is the behaviour the schema comment already describes.
 */
async function resolveChannelConfig(
	guildId: string,
	channelId: string,
): Promise<Pick<SocialChannels, 'ignored' | 'multiplier'> | null> {
	const chain = await resolveChannelChain(channelId);

	const rows = await getContext().db<SocialChannels[]>`
		SELECT * FROM social_channels WHERE guild_id = ${guildId} AND channel_id = ANY(${chain})
	`;

	if (rows.length === 0) {
		return null;
	}

	const byId = new Map<string, SocialChannels>(rows.map((row) => [row.channelId, row]));
	for (const candidate of chain) {
		const row = byId.get(candidate);
		if (row) {
			return row;
		}
	}

	return null;
}

export async function handleTrackedMessage(message: GatewayMessageCreateDispatchData, logger: Logger): Promise<void> {
	// Webhook messages carry no real member and shouldn't earn anyone XP; legacy's `author.bot` check happened
	// to cover most of them, but a webhook post isn't always flagged as a bot author.
	if (!message.guild_id || message.author.bot || message.webhook_id) {
		return;
	}

	const member = message.member;
	if (!member) {
		return;
	}

	// Every message from one member of one guild is handled in order, the same way ModMail serializes a user's
	// ticket-lifecycle events. The eligibility window is a read-modify-write across several redis calls, so two
	// messages arriving together could otherwise both clear the bar before either set it and each earn a grant.
	// Legacy had that race; the lock closes it, and a member's own messages have no reason to be handled
	// concurrently anyway.
	await withGuildUserLock(message.guild_id, message.author.id, async () => {
		await track(message, member, logger);
	});
}

async function track(
	message: GatewayMessageCreateDispatchData,
	member: NonNullable<GatewayMessageCreateDispatchData['member']>,
	logger: Logger,
): Promise<void> {
	const db = getContext().db;
	const guildId = message.guild_id!;
	const userId = message.author.id;

	const [settings] = await db<SocialGuildSettings[]>`
		SELECT * FROM social_guild_settings WHERE guild_id = ${guildId}
	`;

	if (!settings || !isConfigured(settings)) {
		return;
	}

	// Read-only, unlike legacy's upsert-then-check: rows are created by the grant below, so a user who never
	// becomes eligible never gets one. (Legacy's `/level @someone` had the same wart -- see `commands/level.ts`.)
	const [user] = await db<Pick<SocialUsers, 'ignored'>[]>`
		SELECT ignored FROM social_users WHERE guild_id = ${guildId} AND user_id = ${userId}
	`;

	if (user?.ignored) {
		return;
	}

	const channelConfig = await resolveChannelConfig(guildId, message.channel_id);
	if (channelConfig?.ignored) {
		return;
	}

	const eligible = await isEligibleForXp({
		guildId,
		messageId: message.id,
		requiredMessages: settings.requiredMessages,
		timespanSeconds: settings.requiredMessagesTimespan,
		userId,
	});

	if (!eligible) {
		return;
	}

	// **Deliberate fix over legacy:** its role lookup filtered on `roleId` alone, with no `guildId`, so a role
	// multiplier configured in one guild applied to an identically-idd role anywhere -- impossible in practice
	// for real role ids, but the query was plainly wrong and the fix costs nothing.
	const roleMultipliers = member.roles.length
		? await db<Pick<SocialRoles, 'multiplier'>[]>`
				SELECT multiplier FROM social_roles WHERE guild_id = ${guildId} AND role_id = ANY(${member.roles})
			`
		: [];

	// Multipliers stack multiplicatively -- channel first, then the product of every configured role the member
	// holds. Not max-wins; legacy was explicit about this and the schema comment repeats it.
	const increment = roleMultipliers.reduce(
		(total, role) => total * role.multiplier,
		settings.xpGain * (channelConfig?.multiplier ?? 1),
	);

	// One statement, so the increment is applied atomically and the before/after pair below is self-consistent
	// even against a write from another replica. Legacy read the row, computed, and wrote it back.
	const [granted] = await db<Pick<SocialUsers, 'xp'>[]>`
		INSERT INTO social_users (guild_id, user_id, xp)
		VALUES (${guildId}, ${userId}, ${increment})
		ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = social_users.xp + EXCLUDED.xp
		RETURNING xp
	`;

	if (!granted) {
		return;
	}

	// Someone's rank just moved. Fired here rather than after the level/reward work below because that work
	// is conditional -- a guild with no curve configured returns early -- while the XP change, which is the
	// whole content of a leaderboard, has already happened either way.
	await broadcastLeaderboardChange(guildId);

	const newXp = granted.xp;
	const oldXp = newXp - increment;

	const { requiredXpBase, requiredXpMultiplier } = settings;
	if (requiredXpBase === null || requiredXpMultiplier === null) {
		// XP still accrues -- the curve fields are independently nullable from the tracking gate, and a guild
		// part-way through setup shouldn't lose the XP its members are earning. There's just no level to derive
		// from it yet, so rewards and notifications sit this one out.
		return;
	}

	const oldLevel = calculateUserLevel(requiredXpBase, requiredXpMultiplier, oldXp);
	const newLevel = calculateUserLevel(requiredXpBase, requiredXpMultiplier, newXp);

	const rewards = await db<SocialRewards[]>`
		SELECT * FROM social_rewards WHERE guild_id = ${guildId}
	`;

	let rewardsApplied = false;
	if (rewards.length > 0) {
		// Run on every grant, not only on a level-up: legacy's rebuild-the-world approach incidentally repaired
		// a member missing a role they should already have had, and that self-healing is worth keeping. It's
		// free when nothing differs -- the diff is computed against the roles already in the message payload,
		// and no Discord call is made unless there's an actual difference.
		// Two rewards at the same level are decided by the guild's role hierarchy, so the diff needs it -- a
		// cached read (see `getRolePositions`), and only reached once the guild has rewards configured at all.
		const positions = await getRolePositions(guildId);
		const diff = computeRewardRoleDiff({ heldRoleIds: member.roles, level: newLevel, positions, rewards });
		rewardsApplied = await applyRewardRoles({ diff, guildId, heldRoleIds: member.roles, logger, userId });
	}

	if (newLevel > oldLevel) {
		// One line per level-up: the rarest and most user-visible thing this bot does, and the first thing to
		// check when someone reports levelling without their role. Deliberately not logged per grant --
		// `createLogger` pins the level to trace with no env override, so a per-message line would be a volume
		// problem on an active guild. `rewardsConfigured` disambiguates "the write was skipped or failed" from
		// "this guild has no rewards at all", which both leave `rewardsApplied` false.
		logger.info(
			{ guildId, userId, oldLevel, newLevel, increment, rewardsApplied, rewardsConfigured: rewards.length },
			'Member levelled up',
		);

		await sendLevelUpNotification({
			channelId: message.channel_id,
			// Everything crossed by this grant, not just `oldLevel + 1` -- a single message with a large enough
			// multiplier can span more than one level, and legacy silently swallowed the extras (#343 P3).
			//
			// Suppressed entirely when the role write was skipped or failed: announcing "and received: Veteran"
			// to someone who didn't get the role is worse than announcing the level-up alone.
			earnedRewards: rewardsApplied
				? rewards.filter((reward) => reward.level > oldLevel && reward.level <= newLevel)
				: [],
			guildId,
			level: newLevel,
			logger,
			settings,
			userId,
			username: message.author.username,
		});
	}
}
