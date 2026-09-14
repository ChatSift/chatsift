'use client';

import { socialLeaderboardChannel } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { queryKeys } from '@/api/queryClient';
import { useGuildInfo } from '@/api/routes/guilds';
import { useSocialStats } from '@/api/routes/social';
import { StatChip } from '@/components/stats/StatChip';
import { StatChipRow } from '@/components/stats/StatChipRow';
import { StatTile } from '@/components/stats/StatTile';
import { StatTileGrid } from '@/components/stats/StatTileGrid';
import { StatsCard } from '@/components/stats/StatsCard';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

/**
 * The hub page's "is anybody actually levelling up here" answer (#403), mirroring the AMA session page's
 * analytics card.
 *
 * Reward reach is the one number the config pages cannot show: a reward is stored as a level, and how many
 * members ever got there is a fact about the XP ledger, not about the reward. See `getStats.ts` for how it is
 * derived -- a level is never stored, only the XP a level costs.
 */
export function SocialStatsCard() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();
	const { data: stats, isLoading, isError } = useSocialStats(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'SOCIAL');

	useRealtimeInvalidate(socialLeaderboardChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.social.stats(guildId) });
	});

	// Explicitly generic: without it the tuple widens to `string[]` and `.get()` comes back untyped, which
	// the no-base-to-string rule catches the moment it lands in a template string.
	const roleNames = new Map<string, string>(guildInfo?.roles.map((role) => [role.id, role.name]) ?? []);

	return (
		<StatsCard isError={isError} isLoading={isLoading}>
			{stats && (
				<div className="flex flex-col gap-6">
					<StatTileGrid columns={7}>
						<StatTile label="Tracked Members" value={stats.users.tracked} />
						<StatTile label="With XP" valence="good" value={stats.users.withXp} />
						<StatTile label="Opted Out" value={stats.users.ignored} />
						<StatTile label="Total XP" value={stats.users.totalXp.toLocaleString()} />
						<StatTile label="Highest Level" value={stats.users.highestLevel} />
						<StatTile label="Rewards" value={stats.rewards.total} />
						<StatTile label="Multipliers" value={stats.multipliers.channels + stats.multipliers.roles} />
					</StatTileGrid>

					{stats.rewards.reach.length > 0 && (
						<StatChipRow title="Members at Each Reward">
							{stats.rewards.reach.map((reward) => (
								<Link
									className="rounded-md transition-opacity hover:opacity-80"
									href={`/dashboard/${guildId}/social/rewards/${reward.roleId}`}
									key={reward.roleId}
								>
									<StatChip
										label={`${roleNames.get(reward.roleId) ?? 'Unknown role'} (lvl ${reward.level})`}
										value={reward.memberCount}
									/>
								</Link>
							))}
						</StatChipRow>
					)}

					{stats.interactions.top.length > 0 && (
						<StatChipRow
							title={`Busiest Commands (${stats.interactions.total} defined, ${stats.interactions.totalUses} uses)`}
						>
							{stats.interactions.top.map((interaction) => (
								<Link
									className="rounded-md transition-opacity hover:opacity-80"
									href={`/dashboard/${guildId}/social/interactions/${interaction.id}`}
									key={interaction.id}
								>
									<StatChip label={`/${interaction.name}`} value={interaction.uses} />
								</Link>
							))}
						</StatChipRow>
					)}
				</div>
			)}
		</StatsCard>
	);
}
