'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useGuildInfo } from '@/api/routes/guilds';
import type { SocialChannel } from '@/api/routes/social';
import { useDeleteSocialChannel, useSocialChannels } from '@/api/routes/social';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgPlus } from '@/components/icons/SvgPlus';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

interface SocialChannelCardProps {
	readonly channel: SocialChannel;
	/**
	 * The channel's current name on Discord, or `undefined` for one that's since been deleted -- the row outlives
	 * the channel, and the card has to stay actionable (deletable) rather than rendering as a blank.
	 */
	readonly channelName: string | undefined;
	readonly guildId: string;
}

function SocialChannelCard({ channel, channelName, guildId }: SocialChannelCardProps) {
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deleteChannel = useDeleteSocialChannel(guildId);
	const label = channelName ? `#${channelName}` : `Deleted channel (${channel.channelId})`;

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-semibold text-primary dark:text-primary-dark">
				{label}
			</p>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				{channel.ignored
					? 'Grants no XP'
					: channel.multiplier === 1
						? 'No multiplier -- normal XP'
						: `${channel.multiplier}x XP`}
			</p>

			<div className="mt-auto flex justify-end gap-2">
				<Link
					className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
					href={`/dashboard/${guildId}/social/channels/${channel.channelId}`}
				>
					Edit
				</Link>
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Remove</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Remove"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deleteChannel.mutateAsync(channel.channelId)}
				onOpenChange={setIsConfirmOpen}
				title={`Remove ${label}?`}
			>
				{label} goes back to granting normal XP. If it sits inside a category that has its own configuration, that
				configuration starts applying here again.
			</ConfirmModal>
		</div>
	);
}

function AddChannelCard({ guildId }: { readonly guildId: string }) {
	return (
		<Link
			className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 self-stretch rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark"
			href={`/dashboard/${guildId}/social/channels/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Add Channel</span>
		</Link>
	);
}

export function SocialChannelsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: channels, isLoading, error } = useSocialChannels(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'SOCIAL');

	// Same reasoning as `SnippetsList`: a background refetch failure keeps the cached list on screen rather than
	// replacing it with the full error state.
	if (error && channels === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<>
				<AddChannelCard guildId={guildId} />
				<Skeleton className="h-36 w-full rounded-lg" />
				<Skeleton className="h-36 w-full rounded-lg" />
			</>
		);
	}

	return (
		<>
			<AddChannelCard guildId={guildId} />
			{channels!.map((channel) => (
				<SocialChannelCard
					channel={channel}
					channelName={guildInfo?.channels.find((entry) => entry.id === channel.channelId)?.name}
					guildId={guildId}
					key={channel.channelId}
				/>
			))}
		</>
	);
}
