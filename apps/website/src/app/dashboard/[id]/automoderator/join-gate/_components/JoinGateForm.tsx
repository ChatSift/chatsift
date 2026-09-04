'use client';

import { automoderatorConfigChannel, MIN_JOIN_AGE_MAX_SECONDS } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { buttonClass } from '@/components/common/buttonStyles';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { describeDuration, formatDurationInput, parseDurationInput } from '@/utils/duration';

/**
 * The join gate (P6, feature 13): turn away accounts that are too new to have been made by anyone but a raider.
 *
 * One field, and an empty one is off -- the same nullable-means-off shape the auto-pardon and trigger-decay
 * settings use. It takes a duration rather than a number of days, through the same parser the ladder editors
 * use, because "12h" and "30d" are both things servers mean and a days-only box can only express one of them.
 */
export function JoinGateForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorConfigChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.config(guildId) });
	});

	const { data: config, isLoading, error } = useAutomoderatorConfig(guildId);
	const updateConfig = useUpdateAutomoderatorConfig(guildId);

	const [value, setValue] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	// Seeded once, then left alone: a background refetch must not clobber an unsaved edit.
	useEffect(() => {
		if (config && value === null) {
			setValue(formatDurationInput(config.minJoinAgeSeconds));
		}
	}, [config, value]);

	if (error && config === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !config || value === null) {
		return <Skeleton className="h-64 w-full rounded-lg" />;
	}

	const stored = formatDurationInput(config.minJoinAgeSeconds);
	const isDirty = value.trim() !== stored;

	const save = async () => {
		const parsed = parseDurationInput(value, 'optional', {
			maxSeconds: MIN_JOIN_AGE_MAX_SECONDS,
			overMaxMessage: 'A join gate cannot ask for more than a year.',
		});

		if (!parsed.ok) {
			setActionError(parsed.message);
			return;
		}

		setActionError(null);

		try {
			await updateConfig.mutateAsync({ minJoinAgeSeconds: parsed.seconds });
			setValue(formatDurationInput(parsed.seconds));
		} catch (caughtError) {
			setActionError(caughtError instanceof APIError ? caughtError.message : 'Failed to save. Please try again.');
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				{actionError && (
					<p
						className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger"
						role="alert"
					>
						{actionError}
					</p>
				)}

				<p className="text-sm text-secondary dark:text-secondary-dark">
					{config.minJoinAgeSeconds === null
						? 'The join gate is off. Anyone can join, however new their account is.'
						: `The join gate is on: accounts younger than ${describeDuration(config.minJoinAgeSeconds)} are removed as soon as they join.`}
				</p>

				<TextField
					helper={'How old an account has to be, e.g. "12h", "7d", "1mo". Leave empty to turn the gate off.'}
					id="automoderator-min-join-age"
					label="Minimum account age"
					onChange={(next) => {
						setValue(next);
						setActionError(null);
					}}
					placeholder="7d"
					value={value}
				/>

				<div className="flex flex-wrap gap-2">
					<Button
						className={buttonClass('primary', 'sm')}
						isDisabled={!isDirty || updateConfig.isPending}
						onPress={save}
					>
						{updateConfig.isPending ? 'Saving...' : 'Save'}
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<h3 className="text-sm font-medium text-primary dark:text-primary-dark">What happens at the door</h3>
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Too-new accounts are kicked, not banned — they can come back once their account is old enough. Each one files
					a kick case, so{' '}
					<Link className="text-misc-accent hover:underline" href={`/dashboard/${guildId}/automoderator/cases`}>
						Cases
					</Link>{' '}
					answers &quot;why did that member vanish&quot;. Bots added by your staff are never checked, and nothing here
					is affected by bypass roles or exemptions — an account being turned away at the door has no roles yet.
				</p>
			</div>
		</div>
	);
}
