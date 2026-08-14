'use client';

import { ChannelType } from 'discord-api-types/v10';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
	useAutomoderatorLogChannels,
	useDeleteAutomoderatorLogChannel,
	useSetAutomoderatorLogChannel,
} from '@/api/routes/automoderatorCases';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

/**
 * The mod log is the only configurable log at P1. The filter, message and user logs land with the phases that
 * actually write to them (P5 and P4) -- offering a channel picker for a log nothing ever posts to would be a
 * setting that quietly does nothing.
 */
export function LogChannelsForm() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: logChannels, isLoading, error } = useAutomoderatorLogChannels(guildId);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'AUTOMODERATOR');
	const setLogChannel = useSetAutomoderatorLogChannel(guildId);
	const deleteLogChannel = useDeleteAutomoderatorLogChannel(guildId);

	const configured = logChannels?.find((entry) => entry.logType === 'MOD') ?? null;
	const [channelId, setChannelId] = useState<string | null>(null);

	// Seed once, then leave alone, so a background refetch can't clobber an unsaved pick.
	useEffect(() => {
		if (logChannels && channelId === null) {
			setChannelId(configured?.channelId ?? '');
		}
	}, [logChannels, channelId, configured]);

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !logChannels || channelId === null) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	const isDirty = channelId !== (configured?.channelId ?? '');

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<ChannelSelect
				allowedTypes={[ChannelType.GuildText, ChannelType.GuildAnnouncement, ...threadTypes]}
				channels={guildInfo?.channels ?? []}
				isLoading={isGuildInfoLoading}
				label="Mod log channel"
				onChange={(value) => setChannelId(value ?? '')}
				selectedId="automoderator-mod-log-channel"
				value={channelId}
			/>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				Every case is posted here, and edits rewrite the original message rather than posting a new one. Setting this
				creates a webhook in the channel, so the bot needs Manage Webhooks there.
			</p>

			<div className="flex flex-wrap gap-2">
				<Button
					className="rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					isDisabled={!isDirty || !channelId || setLogChannel.isPending}
					onPress={async () => {
						await setLogChannel.mutateAsync({ logType: 'MOD', channelId });
					}}
				>
					{setLogChannel.isPending ? 'Saving...' : 'Save'}
				</Button>

				{configured && (
					<Button
						className="rounded-md bg-on-tertiary px-3 py-2.5 text-primary transition-colors hover:bg-on-secondary dark:bg-on-tertiary-dark dark:text-primary-dark dark:hover:bg-on-secondary-dark"
						isDisabled={deleteLogChannel.isPending}
						onPress={async () => {
							await deleteLogChannel.mutateAsync('MOD');
							setChannelId('');
						}}
					>
						{deleteLogChannel.isPending ? 'Removing...' : 'Stop logging'}
					</Button>
				)}
			</div>
		</div>
	);
}
