'use client';

import { ChannelType } from 'discord-api-types/v10';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APIError } from '@/api/error';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

/**
 * The reports channel doubles as the on/off switch for reporting: with none set, the context menus refuse and
 * nothing is written. That's deliberate -- a queue with nowhere to read it is worse than no queue, and it means
 * there is exactly one thing to configure to turn the feature on.
 */
export function ReportsChannelForm() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: config, isLoading, error } = useAutomoderatorConfig(guildId);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'AUTOMODERATOR');
	const updateConfig = useUpdateAutomoderatorConfig(guildId);

	const [channelId, setChannelId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	useEffect(() => {
		if (config && channelId === null) {
			setChannelId(config.reportsChannelId ?? '');
		}
	}, [config, channelId]);

	if (error && config === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !config || channelId === null) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	const configured = config.reportsChannelId ?? '';
	const isDirty = channelId !== configured;

	const save = async (next: string) => {
		setActionError(null);

		try {
			await updateConfig.mutateAsync({ reportsChannelId: next.length > 0 ? next : null });
			setChannelId(next);
		} catch (caughtError) {
			setActionError(caughtError instanceof APIError ? caughtError.message : 'Failed to save. Please try again.');
		}
	};

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			{actionError && (
				<p className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger" role="alert">
					{actionError}
				</p>
			)}

			<ChannelSelect
				allowedTypes={[ChannelType.GuildText, ChannelType.GuildAnnouncement, ...threadTypes]}
				channels={guildInfo?.channels ?? []}
				isLoading={isGuildInfoLoading}
				label="Reports channel"
				onChange={(value) => setChannelId(value ?? '')}
				selectedId="automoderator-reports-channel"
				value={channelId}
			/>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				Report cards are posted here for your staff to dismiss or action, so this should be a channel only staff can
				see. Unlike the log channels, this uses the bot directly rather than a webhook — it needs Send Messages and
				Embed Links here. Leaving it unset turns reporting off.
			</p>

			<div className="flex flex-wrap gap-2">
				<Button
					className="rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					isDisabled={!isDirty || !channelId || updateConfig.isPending}
					onPress={async () => save(channelId)}
				>
					{updateConfig.isPending ? 'Saving...' : 'Save'}
				</Button>

				{configured.length > 0 && (
					<Button
						className="rounded-md bg-on-tertiary px-3 py-2.5 text-primary transition-colors hover:bg-on-secondary dark:bg-on-tertiary-dark dark:text-primary-dark dark:hover:bg-on-secondary-dark"
						isDisabled={updateConfig.isPending}
						onPress={async () => save('')}
					>
						Stop accepting reports
					</Button>
				)}
			</div>
		</div>
	);
}
