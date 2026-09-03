'use client';

import { automoderatorLogExemptionsChannel, LOG_EXEMPTION_MAX_COUNT } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { ChannelType } from 'discord-api-types/v10';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import {
	useAutomoderatorLogExemptions,
	useDeleteAutomoderatorLogExemption,
	useSetAutomoderatorLogExemption,
} from '@/api/routes/automoderatorCases';
import type { GuildChannelInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { buttonClass } from '@/components/common/buttonStyles';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { getChannelIcon } from '@/utils/channels';

/**
 * Everything that can hold messages, plus categories. A category is the point of the feature -- one row
 * silences everything under it, now and in future -- and forums are here because a forum post is a thread whose
 * parent is the forum, so exempting the forum is the only way to cover posts nobody has created yet.
 */
const EXEMPTABLE_TYPES = [
	ChannelType.GuildCategory,
	ChannelType.GuildText,
	ChannelType.GuildAnnouncement,
	ChannelType.GuildForum,
	ChannelType.GuildMedia,
	ChannelType.GuildVoice,
	ChannelType.GuildStageVoice,
	...threadTypes,
];

function ExemptRow({
	channel,
	channelId,
	guildId,
	isChannelsLoading,
}: {
	readonly channel: GuildChannelInfo | undefined;
	readonly channelId: string;
	readonly guildId: string;
	readonly isChannelsLoading: boolean;
}) {
	const deleteExemption = useDeleteAutomoderatorLogExemption(guildId);
	const [error, setError] = useState<string | null>(null);

	const Icon = channel ? getChannelIcon(channel.type) : null;

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary p-3 dark:border-on-secondary-dark sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-center gap-2">
				{Icon && <Icon className="shrink-0 text-secondary dark:text-secondary-dark" size={16} />}
				{channel ? (
					<span className="truncate text-sm text-primary dark:text-primary-dark">{channel.name}</span>
				) : (
					// A config row outliving the channel it names is the bug class this dashboard keeps hitting, so
					// it is stated rather than rendered as a blank -- and the row stays removable, which is the
					// whole point of saying so.
					<span className="truncate text-sm text-misc-danger">
						{isChannelsLoading ? 'Loading…' : `Deleted channel (${channelId})`}
					</span>
				)}
			</div>

			<div className="flex items-center gap-2">
				{error && <span className="text-sm text-misc-danger">{error}</span>}
				<Button
					className={buttonClass('secondary', 'sm')}
					isDisabled={deleteExemption.isPending}
					onPress={async () => {
						try {
							await deleteExemption.mutateAsync(channelId);
						} catch (caughtError) {
							setError(caughtError instanceof APIError ? caughtError.message : 'Failed to remove.');
						}
					}}
				>
					Remove
				</Button>
			</div>
		</div>
	);
}

/**
 * Channels the message log never reports on (P4, feature 35). Matched up the channel tree by the bot, so a
 * category listed here covers every channel and thread under it.
 */
export function LogExemptionsForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorLogExemptionsChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.logExemptions(guildId) });
	});

	const { data: exemptions, isLoading, error } = useAutomoderatorLogExemptions(guildId);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'AUTOMODERATOR');
	const setExemption = useSetAutomoderatorLogExemption(guildId);

	const [draft, setDraft] = useState('');
	const [addError, setAddError] = useState<string | null>(null);

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !exemptions) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	const exemptIds = exemptions.map((entry) => entry.channelId);
	const atLimit = exemptions.length >= LOG_EXEMPTION_MAX_COUNT;

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-sm text-secondary dark:text-secondary-dark">
				Edits and deletions in these channels are never posted to the message log. Exempting a category covers
				everything inside it, including threads, so one row is usually enough. Moderation cases are unaffected — a ban
				still appears in the mod log wherever it happened.
			</p>

			{exemptions.length === 0 ? (
				<EmptyState
					icon={<SvgAutoModerator height={28} width={28} />}
					subtitle="Every channel is logged. Add the ones staff don't want reported on — a bot-command channel, or anywhere the noise outweighs the record."
					title="No exempt channels"
				/>
			) : (
				<div className="flex flex-col gap-2">
					{exemptions.map((entry) => (
						<ExemptRow
							channel={guildInfo?.channels.find((channel) => channel.id === entry.channelId)}
							channelId={entry.channelId}
							guildId={guildId}
							isChannelsLoading={isGuildInfoLoading}
							key={entry.channelId}
						/>
					))}
				</div>
			)}

			<div className="flex flex-col gap-2 border-t border-on-secondary pt-4 dark:border-on-secondary-dark sm:flex-row sm:items-end">
				<div className="flex-1">
					<ChannelSelect
						allowedTypes={EXEMPTABLE_TYPES}
						channels={guildInfo?.channels ?? []}
						// Already-exempt channels stay listed but unpickable, so the picker explains itself instead of
						// looking like it lost half the server.
						disabledIds={exemptIds}
						disabledReason="already exempt"
						error={addError ?? undefined}
						isLoading={isGuildInfoLoading}
						label="Add a channel or category"
						onChange={(value) => {
							setDraft(value ?? '');
							setAddError(null);
						}}
						selectedId="automoderator-log-exemption-new"
						value={draft}
					/>
				</div>

				<Button
					className={buttonClass('primary', 'field')}
					isDisabled={atLimit || draft === '' || setExemption.isPending}
					onPress={async () => {
						try {
							await setExemption.mutateAsync(draft);
							setDraft('');
						} catch (caughtError) {
							setAddError(caughtError instanceof APIError ? caughtError.message : 'Failed to add.');
						}
					}}
				>
					{setExemption.isPending ? 'Adding...' : 'Add'}
				</Button>
			</div>

			{atLimit && (
				<p className="text-sm text-misc-warning dark:text-misc-warning-dark">
					You already have {LOG_EXEMPTION_MAX_COUNT} exempt channels. Exempt a category instead of listing its channels
					one by one.
				</p>
			)}
		</div>
	);
}
