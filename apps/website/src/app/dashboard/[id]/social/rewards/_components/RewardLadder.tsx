'use client';

import { resolveEarnedRewards } from '@chatsift/core';
import { useParams } from 'next/navigation';
import type { GuildRoleInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import type { SocialReward } from '@/api/routes/social';
import { useSocialRewards } from '@/api/routes/social';
import { cn } from '@/utils/util';

/**
 * Discord renders a role with no color as grey rather than black. Same rule `RoleSelect` applies to its dots.
 */
function roleColor(role: GuildRoleInfo | undefined): string {
	if (!role || role.color === 0) {
		return '#99aab5';
	}

	return `#${role.color.toString(16).padStart(6, '0')}`;
}

/**
 * Every role a member at `level` ends up holding, as a set -- the tier plus the stacking rewards, which is what
 * `resolveEarnedRewards` already decides. Callers diff two of these to describe a rung.
 */
function heldRoleIds(rewards: readonly SocialReward[], level: number): Set<string> {
	const { stacking, tier } = resolveEarnedRewards(rewards, level);
	return new Set([...(tier ? [tier.roleId] : []), ...stacking.map((reward) => reward.roleId)]);
}

interface RoleChipProps {
	readonly isTier?: boolean;
	readonly role: GuildRoleInfo | undefined;
	readonly roleId: string;
}

function RoleChip({ isTier = false, role, roleId }: RoleChipProps) {
	return (
		<span
			className={cn(
				'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
				isTier
					? 'border-misc-accent/40 bg-misc-accent/10 text-misc-accent'
					: 'border-on-secondary text-secondary dark:border-on-secondary-dark dark:text-secondary-dark',
			)}
		>
			<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: roleColor(role) }} />
			{role ? role.name : `Deleted role (${roleId})`}
		</span>
	);
}

/**
 * The rewards page's overview: what a member actually ends up wearing at each configured level, rather than a
 * grid of rows that each only describe themselves. The tier rule ("only one of these at a time") is the part of
 * this feature people get wrong -- specifically that a tiered reward only ever replaces *other* tiered ones --
 * and reading it off a list of independent cards is close to impossible.
 *
 * The held set comes from `@chatsift/core`'s `resolveEarnedRewards`, the same function the bot decides real role
 * assignments with, so this can't quietly describe a ladder nobody climbs.
 */
export function RewardLadder() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: rewards } = useSocialRewards(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'SOCIAL');

	if (!rewards || rewards.length === 0) {
		return null;
	}

	const roleById = new Map((guildInfo?.roles ?? []).map((role) => [role.id, role]));
	// One rung per level that actually rewards something -- two roles at the same level share a rung, which is
	// also how the member experiences it.
	const levels = [...new Set(rewards.map((reward) => reward.level))].sort((a, b) => a - b);
	const hasTiers = rewards.some((reward) => reward.clean);

	const rungs = levels.map((level) => {
		const { stacking, tier } = resolveEarnedRewards(rewards, level);
		// Diffed against the rung below rather than read off the rows configured *at* this level: those are not
		// the same thing. Two clean rewards at one level mean only one of them is ever held, so listing the raw
		// rows would name a role the chips above deliberately leave out.
		const held = heldRoleIds(rewards, level);
		const previouslyHeld = heldRoleIds(rewards, level - 1);

		return {
			level,
			tier,
			stacking,
			entering: [...held].filter((roleId) => !previouslyHeld.has(roleId)),
			// Whatever stops being held here -- only ever a superseded clean tier, since stacking rewards are
			// never taken back off.
			leaving: [...previouslyHeld].filter((roleId) => !held.has(roleId)),
		};
	});

	return (
		<div className="space-y-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark md:col-span-2 lg:col-span-3">
			<div>
				<h3 className="text-sm font-medium text-primary dark:text-primary-dark">The ladder</h3>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
					{hasTiers
						? 'Everything a member is wearing once they reach each level. Highlighted roles are the "only one of these at a time" kind -- each one replaces the previous highlighted role and nothing else.'
						: 'Everything a member is wearing once they reach each level. Every reward here stacks; nothing is ever taken back off.'}
				</p>
			</div>

			<ol className="space-y-0">
				{rungs.map((rung, index) => {
					const label = (roleId: string) => `@${roleById.get(roleId)?.name ?? roleId}`;
					const earnsLabel = rung.entering.map((roleId) => label(roleId)).join(', ');
					const replacesLabel = rung.leaving.length > 0 ? rung.leaving.map((roleId) => label(roleId)).join(', ') : null;

					return (
						<li className="flex gap-3" key={rung.level}>
							{/* The rail: a dot per rung, joined by a line to the next one. */}
							<div className="flex shrink-0 flex-col items-center">
								<span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-misc-accent" />
								{index < rungs.length - 1 && <span className="w-px flex-1 bg-on-secondary dark:bg-on-secondary-dark" />}
							</div>

							<div className="flex-1 pb-5">
								<p className="text-sm font-medium text-primary dark:text-primary-dark">Level {rung.level}</p>
								<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
									{rung.tier && <RoleChip isTier role={roleById.get(rung.tier.roleId)} roleId={rung.tier.roleId} />}
									{rung.stacking.map((reward) => (
										<RoleChip key={reward.roleId} role={roleById.get(reward.roleId)} roleId={reward.roleId} />
									))}
								</div>
								{/* Which of the chips above are new here, as opposed to carried up from a lower rung -- a rung
								    of five chips otherwise gives no clue what reaching this level actually did. */}
								<p className="mt-1 text-xs text-secondary dark:text-secondary-dark">
									{earnsLabel
										? `Earns ${earnsLabel}${replacesLabel ? `, replacing ${replacesLabel}` : ''}`
										: // Reachable only by configuring two "only one of these at a time" rewards at the same
											// level, where one of them can never be held. Worth saying out loud rather than
											// rendering an empty line, since it's a mistake nothing else on this page shows.
											'Nothing new -- another reward at this level takes precedence.'}
								</p>
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
