'use client';

import type { WritableLogType } from '@chatsift/api/automoderator-schemas';
import { WRITABLE_LOG_TYPES } from '@chatsift/api/automoderator-schemas';
import { automoderatorLogChannelsChannel } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { ChannelType } from 'discord-api-types/v10';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import type { AutomoderatorLogChannels } from '@/api/routes/automoderatorCases';
import {
	useAutomoderatorLogChannels,
	useDeleteAutomoderatorLogChannel,
	useSetAutomoderatorLogChannel,
} from '@/api/routes/automoderatorCases';
import type { GuildChannelInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

/**
 * What each log is for, in the guild's words rather than the schema's. Keyed off `WRITABLE_LOG_TYPES` so a log
 * type the API starts accepting cannot be rendered without someone writing copy for it -- FILTER is missing
 * from both until P5 gives it something to post.
 */
const LOG_COPY: Record<WritableLogType, { description: string; label: string }> = {
	MOD: {
		label: 'Mod log',
		description: 'Every case is posted here, and edits rewrite the original message rather than posting a new one.',
	},
	MESSAGE: {
		label: 'Message log',
		description:
			'Edited and deleted messages, with what they used to say and who deleted them. Channels on the ignore list never appear here.',
	},
	USER: {
		label: 'User log',
		description: 'Nickname, username and display name changes for members of this server.',
	},
};

function LogChannelRow({
	channels,
	configured,
	guildId,
	isChannelsLoading,
	logType,
}: {
	readonly channels: GuildChannelInfo[];
	readonly configured: AutomoderatorLogChannels[number] | null;
	readonly guildId: string;
	readonly isChannelsLoading: boolean;
	readonly logType: WritableLogType;
}) {
	const setLogChannel = useSetAutomoderatorLogChannel(guildId);
	const deleteLogChannel = useDeleteAutomoderatorLogChannel(guildId);

	// Seeded from the server value at mount only. The parent keys this row on that same value, so a change made
	// in another tab remounts the row rather than leaving stale local state -- which is what lets this be a
	// plain initializer instead of an effect a background refetch could fire at the wrong moment.
	const [channelId, setChannelId] = useState(configured?.channelId ?? '');
	const [error, setError] = useState<string | null>(null);

	const isDirty = channelId !== (configured?.channelId ?? '');
	const { label, description } = LOG_COPY[logType];

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-on-secondary p-4 dark:border-on-secondary-dark">
			<ChannelSelect
				allowedTypes={[ChannelType.GuildText, ChannelType.GuildAnnouncement, ...threadTypes]}
				channels={channels}
				error={error ?? undefined}
				isLoading={isChannelsLoading}
				label={label}
				onChange={(value) => {
					setChannelId(value ?? '');
					setError(null);
				}}
				selectedId={`automoderator-${logType.toLowerCase()}-log-channel`}
				value={channelId}
			/>

			<p className="text-sm text-secondary dark:text-secondary-dark">{description}</p>

			<div className="flex flex-wrap gap-2">
				<Button
					className="rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					isDisabled={!isDirty || !channelId || setLogChannel.isPending}
					onPress={async () => {
						try {
							await setLogChannel.mutateAsync({ logType, channelId });
						} catch (caughtError) {
							setError(caughtError instanceof APIError ? caughtError.message : 'Failed to save.');
						}
					}}
				>
					{setLogChannel.isPending ? 'Saving...' : 'Save'}
				</Button>

				{configured && (
					<Button
						className="rounded-md bg-on-tertiary px-3 py-2.5 text-primary transition-colors hover:bg-on-secondary dark:bg-on-tertiary-dark dark:text-primary-dark dark:hover:bg-on-secondary-dark"
						isDisabled={deleteLogChannel.isPending}
						onPress={async () => {
							try {
								await deleteLogChannel.mutateAsync(logType);
								setChannelId('');
							} catch (caughtError) {
								setError(caughtError instanceof APIError ? caughtError.message : 'Failed to remove.');
							}
						}}
					>
						{deleteLogChannel.isPending ? 'Removing...' : 'Stop logging'}
					</Button>
				)}
			</div>
		</div>
	);
}

/**
 * The mod log was the only configurable one at P1; P4 added the message and user logs alongside it. The filter
 * log lands with P5, which is the phase that dispatches into it -- offering a channel picker for a log nothing
 * ever posts to would be a setting that quietly does nothing.
 */
export function LogChannelsForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorLogChannelsChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.logChannels(guildId) });
	});

	const { data: logChannels, isLoading, error } = useAutomoderatorLogChannels(guildId);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'AUTOMODERATOR');

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !logChannels) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-sm text-secondary dark:text-secondary-dark">
				Each log posts through its own webhook, so the bot needs Manage Webhooks in whichever channel you pick. A thread
				works too — the webhook is created on its parent channel.
			</p>

			{WRITABLE_LOG_TYPES.map((logType) => {
				const configured = logChannels.find((entry) => entry.logType === logType) ?? null;

				return (
					<LogChannelRow
						channels={guildInfo?.channels ?? []}
						configured={configured}
						guildId={guildId}
						isChannelsLoading={isGuildInfoLoading}
						key={`${logType}-${configured?.channelId ?? 'none'}`}
						logType={logType}
					/>
				);
			})}
		</div>
	);
}
