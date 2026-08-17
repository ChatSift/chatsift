'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { GuildRoleInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import type { SocialReward } from '@/api/routes/social';
import { useDeleteSocialReward, useSocialRewards } from '@/api/routes/social';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgPlus } from '@/components/icons/SvgPlus';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

interface SocialRewardCardProps {
	readonly guildId: string;
	readonly reward: SocialReward;
	readonly roleInfo: GuildRoleInfo | undefined;
}

function SocialRewardCard({ guildId, reward, roleInfo }: SocialRewardCardProps) {
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deleteReward = useDeleteSocialReward(guildId);
	const label = roleInfo ? `@${roleInfo.name}` : `Deleted role (${reward.roleId})`;

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Level {reward.level}</p>
			<p className="truncate text-lg font-semibold text-primary dark:text-primary-dark">{label}</p>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				{reward.clean ? 'Replaces the previous tier' : 'Kept alongside earlier rewards'}
			</p>

			{/* The whole point of the note is being readable at a glance next to the role, so it renders in full
			    rather than truncated -- `whitespace-pre-line` keeps any line breaks a mod typed. Cards in this grid
			    already size to their content, so a longer note grows its own card instead of clipping. */}
			{reward.description && (
				<p className="whitespace-pre-line break-words border-l-2 border-on-secondary pl-2 text-sm text-secondary dark:border-on-secondary-dark dark:text-secondary-dark">
					{reward.description}
				</p>
			)}

			<div className="mt-auto flex justify-end gap-2">
				<Link
					className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
					href={`/dashboard/${guildId}/social/rewards/${reward.roleId}`}
				>
					Edit
				</Link>
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Delete</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Delete reward"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deleteReward.mutateAsync(reward.roleId)}
				onOpenChange={setIsConfirmOpen}
				title={`Stop rewarding ${label}?`}
			>
				Nobody new will receive {label} on reaching level {reward.level}. Members who already have it keep it -- taking
				it back off them is a Discord-side job.
			</ConfirmModal>
		</div>
	);
}

function AddRewardCard({ guildId }: { readonly guildId: string }) {
	return (
		<Link
			className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 self-stretch rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark"
			href={`/dashboard/${guildId}/social/rewards/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Add Reward</span>
		</Link>
	);
}

export function SocialRewardsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: rewards, isLoading, error } = useSocialRewards(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'SOCIAL');

	if (error && rewards === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<>
				<AddRewardCard guildId={guildId} />
				<Skeleton className="h-36 w-full rounded-lg" />
				<Skeleton className="h-36 w-full rounded-lg" />
			</>
		);
	}

	return (
		<>
			<AddRewardCard guildId={guildId} />
			{/* Already ordered by level server-side -- the ladder is the only meaningful order here. */}
			{rewards!.map((reward) => (
				<SocialRewardCard
					guildId={guildId}
					key={reward.roleId}
					reward={reward}
					roleInfo={guildInfo?.roles.find((entry) => entry.id === reward.roleId)}
				/>
			))}
		</>
	);
}
