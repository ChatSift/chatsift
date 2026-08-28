'use client';

import { automoderatorFilterExemptionsChannel, FILTER_EXEMPTION_MAX_COUNT } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { ChannelType } from 'discord-api-types/v10';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import type { FilterExemption, FilterKind } from '@/api/routes/automoderatorFilters';
import {
	useAutomoderatorFilterExemptions,
	useDeleteAutomoderatorFilterExemption,
	useSetAutomoderatorFilterExemption,
} from '@/api/routes/automoderatorFilters';
import type { GuildChannelInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { getChannelIcon } from '@/utils/channels';
import { cn } from '@/utils/util';

/**
 * Everything that can hold messages, plus categories -- the same set the log exemptions page offers, and for
 * the same reasons: a category is the point of the feature, and a forum has to be exemptable because a forum
 * post is a thread nobody has created yet.
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

const FILTERS: { readonly kind: FilterKind; readonly label: string }[] = [
	{ kind: 'URLS', label: 'URLs' },
	{ kind: 'INVITES', label: 'Invites' },
	{ kind: 'ANTISPAM', label: 'Anti-spam' },
];

/**
 * Channels the runner filters never act in (P5b, feature 09).
 *
 * One row per channel with a toggle per filter, which is why the API takes the full set rather than a delta --
 * the row *is* the state, and sending it whole is what stops the two drifting apart.
 */
export function FilterExemptionsForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorFilterExemptionsChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.filterExemptions(guildId) });
	});

	const { data: exemptions, isLoading, error } = useAutomoderatorFilterExemptions(guildId);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'AUTOMODERATOR');
	const setExemption = useSetAutomoderatorFilterExemption(guildId);

	const [draft, setDraft] = useState('');
	const [addError, setAddError] = useState<string | null>(null);

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !exemptions) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	const exemptIds = exemptions.map((entry) => entry.channelId);
	const atLimit = exemptions.length >= FILTER_EXEMPTION_MAX_COUNT;

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-sm text-secondary dark:text-secondary-dark">
				The URL and invite filters never act in these channels. Exempting a category covers everything inside it,
				including threads, so one row is usually enough. This does not affect Discord&apos;s own AutoMod — a banned word
				is still caught here, because that match happens on Discord&apos;s side and is exempted per rule in Server
				Settings.
			</p>

			{exemptions.length === 0 ? (
				<EmptyState
					icon={<SvgAutoModerator height={28} width={28} />}
					subtitle="The filters run everywhere. Add the channels where they shouldn't — a staff channel, or one where links are the point."
					title="No exempt channels"
				/>
			) : (
				<div className="flex flex-col gap-2">
					{exemptions.map((entry) => (
						<ExemptRow
							channel={guildInfo?.channels.find((channel) => channel.id === entry.channelId)}
							entry={entry}
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
						disabledIds={exemptIds}
						disabledReason="already exempt"
						error={addError ?? undefined}
						isLoading={isGuildInfoLoading}
						label="Add a channel or category"
						onChange={(value) => {
							setDraft(value ?? '');
							setAddError(null);
						}}
						selectedId="automoderator-filter-exemption-new"
						value={draft}
					/>
				</div>

				<Button
					className="rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					isDisabled={atLimit || draft === '' || setExemption.isPending}
					onPress={async () => {
						try {
							// Added exempt from both filters, then narrowed with the toggles. The alternative -- adding
							// with nothing ticked -- is a row that does nothing, and the API rejects it for that reason.
							await setExemption.mutateAsync({ channelId: draft, filters: FILTERS.map((filter) => filter.kind) });
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
					You already have {FILTER_EXEMPTION_MAX_COUNT} exempt channels. Exempt a category instead of listing its
					channels one by one.
				</p>
			)}
		</div>
	);
}

function ExemptRow({
	channel,
	entry,
	guildId,
	isChannelsLoading,
}: {
	readonly channel: GuildChannelInfo | undefined;
	readonly entry: FilterExemption;
	readonly guildId: string;
	readonly isChannelsLoading: boolean;
}) {
	const setExemption = useSetAutomoderatorFilterExemption(guildId);
	const deleteExemption = useDeleteAutomoderatorFilterExemption(guildId);
	const [error, setError] = useState<string | null>(null);

	const Icon = channel ? getChannelIcon(channel.type) : null;
	const isPending = setExemption.isPending || deleteExemption.isPending;

	const toggle = async (kind: FilterKind) => {
		const next = entry.filters.includes(kind)
			? entry.filters.filter((filter) => filter !== kind)
			: [...entry.filters, kind];

		setError(null);

		try {
			// Unticking the last filter removes the channel outright: "exempt from nothing" and "not in the list"
			// are the same state, and leaving an inert row behind would read as a setting that stopped working.
			await (next.length === 0
				? deleteExemption.mutateAsync(entry.channelId)
				: setExemption.mutateAsync({ channelId: entry.channelId, filters: next }));
		} catch (caughtError) {
			setError(caughtError instanceof APIError ? caughtError.message : 'Failed to save.');
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary p-3 dark:border-on-secondary-dark sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-center gap-2">
				{Icon && <Icon className="shrink-0 text-secondary dark:text-secondary-dark" size={16} />}
				{channel ? (
					<span className="truncate text-sm text-primary dark:text-primary-dark">{channel.name}</span>
				) : (
					// A config row outliving the channel it names is the bug class this dashboard keeps hitting, so it
					// is stated rather than rendered as a blank -- and the row stays removable.
					<span className="truncate text-sm text-misc-danger">
						{isChannelsLoading ? 'Loading…' : `Deleted channel (${entry.channelId})`}
					</span>
				)}
			</div>

			<div className="flex items-center gap-2">
				{error && <span className="text-sm text-misc-danger">{error}</span>}

				<div
					aria-label="Exempt from"
					className="inline-flex gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
					role="group"
				>
					{FILTERS.map((filter) => {
						const isOn = entry.filters.includes(filter.kind);

						return (
							<Button
								aria-pressed={isOn}
								className={cn(
									'rounded px-3 py-1.5 text-sm font-medium transition-colors',
									isOn
										? 'bg-misc-accent text-accent shadow-sm'
										: 'text-secondary hover:bg-on-secondary/50 dark:text-secondary-dark dark:hover:bg-on-secondary-dark/50',
								)}
								isDisabled={isPending}
								key={filter.kind}
								onPress={async () => toggle(filter.kind)}
								type="button"
							>
								{filter.label}
							</Button>
						);
					})}
				</div>

				<Button
					className="rounded-md bg-on-tertiary px-3 py-2 text-primary transition-colors hover:bg-on-secondary dark:bg-on-tertiary-dark dark:text-primary-dark dark:hover:bg-on-secondary-dark"
					isDisabled={isPending}
					onPress={async () => {
						try {
							await deleteExemption.mutateAsync(entry.channelId);
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
