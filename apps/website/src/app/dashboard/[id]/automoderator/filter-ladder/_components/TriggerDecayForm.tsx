'use client';

import { TRIGGER_DECAY_MAX_MINUTES } from '@chatsift/core';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APIError } from '@/api/error';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

/**
 * How fast filter triggers fall off a member's count. Lives beside the ladder rather than on the config page
 * for the same reason `AutoPardonForm` lives beside the warn ladder: it is only ever meaningful against one, and
 * it decides which triggers are still counted when a step is checked.
 */
export function TriggerDecayForm() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: config, isLoading, error } = useAutomoderatorConfig(guildId);
	const updateConfig = useUpdateAutomoderatorConfig(guildId);

	const [minutes, setMinutes] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	// Seeded once, then left alone: a background refetch must not clobber an unsaved edit.
	useEffect(() => {
		if (config && minutes === null) {
			setMinutes(config.triggerDecayMinutes === null ? '' : String(config.triggerDecayMinutes));
		}
	}, [config, minutes]);

	if (error && config === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !config || minutes === null) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	const configured = config.triggerDecayMinutes === null ? '' : String(config.triggerDecayMinutes);
	const isDirty = minutes.trim() !== configured;

	const save = async (next: string) => {
		const trimmed = next.trim();
		let value: number | null = null;

		if (trimmed.length > 0) {
			value = Number(trimmed);

			if (!Number.isInteger(value) || value < 1 || value > TRIGGER_DECAY_MAX_MINUTES) {
				setActionError(`Pick a whole number of minutes between 1 and ${TRIGGER_DECAY_MAX_MINUTES}, or leave it empty.`);
				return;
			}
		}

		setActionError(null);

		try {
			await updateConfig.mutateAsync({ triggerDecayMinutes: value });
			setMinutes(trimmed);
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

			<TextField
				helper="Leave empty for triggers that never expire."
				id="automoderator-trigger-decay"
				label="Drop one trigger every (minutes)"
				onChange={(value) => {
					setMinutes(value);
					setActionError(null);
				}}
				placeholder="60"
				value={minutes}
			/>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				One trigger comes off every member&apos;s count on this interval, so somebody who tripped a filter twice last
				month isn&apos;t one hit away from a ban today. Decay runs in the background, and catches up on however long has
				passed rather than only ever dropping one.
			</p>

			<div className="flex flex-wrap gap-2">
				<Button
					className="rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					isDisabled={!isDirty || updateConfig.isPending}
					onPress={async () => save(minutes)}
				>
					{updateConfig.isPending ? 'Saving...' : 'Save'}
				</Button>
			</div>
		</div>
	);
}
