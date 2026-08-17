'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APIError } from '@/api/error';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

const MAX_DAYS = 3_650;

/**
 * How long a warning counts for. Lives beside the ladder rather than on the config page because it is only ever
 * meaningful against one: it decides which warnings are still counted when a step is checked.
 */
export function AutoPardonForm() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: config, isLoading, error } = useAutomoderatorConfig(guildId);
	const updateConfig = useUpdateAutomoderatorConfig(guildId);

	const [days, setDays] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	// Seeded once, then left alone: a background refetch must not clobber an unsaved edit.
	useEffect(() => {
		if (config && days === null) {
			setDays(config.autoPardonWarnsAfter === null ? '' : String(config.autoPardonWarnsAfter));
		}
	}, [config, days]);

	if (error && config === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !config || days === null) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	const configured = config.autoPardonWarnsAfter === null ? '' : String(config.autoPardonWarnsAfter);
	const isDirty = days.trim() !== configured;

	const save = async (next: string) => {
		const trimmed = next.trim();
		let value: number | null = null;

		if (trimmed.length > 0) {
			value = Number(trimmed);

			if (!Number.isInteger(value) || value < 1 || value > MAX_DAYS) {
				setActionError(`Pick a whole number of days between 1 and ${MAX_DAYS}, or leave it empty.`);
				return;
			}
		}

		setActionError(null);

		try {
			await updateConfig.mutateAsync({ autoPardonWarnsAfter: value });
			setDays(trimmed);
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
				helper="Leave empty for warnings that never expire."
				id="automoderator-auto-pardon"
				label="Pardon warnings after (days)"
				onChange={(value) => {
					setDays(value);
					setActionError(null);
				}}
				placeholder="30"
				value={days}
			/>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				A pardoned warning stays on the member's record but stops counting toward the ladder above. Pardoning happens in
				the background, so turning this on will work through any warnings already older than this over the next few
				minutes.
			</p>

			<div className="flex flex-wrap gap-2">
				<Button
					className="rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					isDisabled={!isDirty || updateConfig.isPending}
					onPress={async () => save(days)}
				>
					{updateConfig.isPending ? 'Saving...' : 'Save'}
				</Button>
			</div>
		</div>
	);
}
