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
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

/**
 * What each log is for, in the guild's words rather than the schema's. Keyed off `WRITABLE_LOG_TYPES` so a log
 * type the API starts accepting cannot be rendered without someone writing copy for it.
 */
const LOG_COPY: Record<WritableLogType, { description: string; label: string }> = {
	MOD: {
		label: 'Mod log',
		description: 'Every case is posted here, and edits rewrite the original message rather than posting a new one.',
	},
	FILTER: {
		label: 'Filter log',
		description:
			'Every filter hit, including the ones no policy responded to. This is where you find out a rule is catching more than you expected.',
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

/**
 * One log type's channel picker. Saves on select rather than behind a Save button, and picking "Disable
 * logging" is how the log is turned off (#375) -- the pair of buttons this replaced meant a two-step choose-
 * then-confirm for a single-value setting, and "Stop logging" was a button that only existed once a channel was
 * already set. Same immediate-write convention as `FilterToggle` and the allowlist rows on the filter pages.
 */
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
	// plain initializer instead of an effect a background refetch could fire at the wrong moment. Held locally
	// at all so the picker shows the new channel the moment it's clicked, not once the write comes back.
	const [channelId, setChannelId] = useState(configured?.channelId ?? '');
	const [error, setError] = useState<string | null>(null);

	const isPending = setLogChannel.isPending || deleteLogChannel.isPending;
	const { label, description } = LOG_COPY[logType];

	const save = async (nextChannelId: string) => {
		const previous = channelId;
		setChannelId(nextChannelId);
		setError(null);

		try {
			await (nextChannelId
				? setLogChannel.mutateAsync({ logType, channelId: nextChannelId })
				: deleteLogChannel.mutateAsync(logType));
		} catch (caughtError) {
			// Put the picker back to what is actually stored: an immediate-write control that keeps showing the
			// rejected choice reads as saved.
			setChannelId(previous);
			setError(caughtError instanceof APIError ? caughtError.message : 'Failed to save.');
		}
	};

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-on-secondary p-4 dark:border-on-secondary-dark">
			{/* Genuinely disabled, not just `pointer-events-none` on a wrapper: a second pick mid-write would race
				the first (two PUTs, no ordering guarantee), and a wrapper leaves the trigger focusable so Enter
				still starts one. */}
			<ChannelSelect
				allowedTypes={[ChannelType.GuildText, ChannelType.GuildAnnouncement, ...threadTypes]}
				channels={channels}
				error={error ?? undefined}
				isDisabled={isPending}
				isLoading={isChannelsLoading}
				label={label}
				noneLabel="Disable logging"
				onChange={(value) => {
					void save(value ?? '');
				}}
				selectedId={`automoderator-${logType.toLowerCase()}-log-channel`}
				value={channelId}
			/>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				{isPending ? 'Saving...' : channelId ? description : `Off. ${description}`}
			</p>
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
				works too — the webhook is created on its parent channel. Picking a channel saves straight away.
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
