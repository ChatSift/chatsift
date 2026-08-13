'use client';

import { updateAutomoderatorConfigBodySchema } from '@chatsift/api/automoderator-schemas';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APIError } from '@/api/error';
import type { UpdateAutomoderatorConfigBody } from '@/api/routes/automoderator';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { cn } from '@/utils/util';

const DRY_RUN_CHOICES = [true, false] as const;

const DRY_RUN_LABELS = new Map<boolean, string>([
	[true, 'Simulate only'],
	[false, 'Act for real'],
]);

const DRY_RUN_DESCRIPTIONS = new Map<boolean, string>([
	[
		true,
		'AutoModerator works out what it would do and records it, but never actually bans, kicks, times anyone out, or deletes anything.',
	],
	[false, 'Actions are carried out for real.'],
]);

export function AutomoderatorConfigForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const [dryRun, setDryRun] = useState<boolean | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const { data: config, isLoading, error } = useAutomoderatorConfig(guildId);
	const updateConfig = useUpdateAutomoderatorConfig(guildId);

	// Seed once, then leave alone: a background refetch after saving must not clobber an unsaved choice. Same
	// shape as `SocialConfigForm`/`ModmailConfigForm`.
	useEffect(() => {
		if (config && dryRun === null) {
			setDryRun(config.dryRun);
		}
	}, [config, dryRun]);

	if (error && config === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || dryRun === null) {
		return (
			<div className="space-y-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}

	const handleSave = async () => {
		const result = updateAutomoderatorConfigBodySchema.safeParse({ dryRun });
		if (!result.success) {
			setActionError(result.error.issues[0]?.message ?? 'Invalid configuration.');
			return;
		}

		setActionError(null);
		setSuccessMessage(null);

		try {
			await updateConfig.mutateAsync(result.data as UpdateAutomoderatorConfigBody);
			setSuccessMessage('Configuration updated.');
		} catch (caughtError) {
			setActionError(
				caughtError instanceof APIError ? caughtError.message : 'Failed to update config. Please try again.',
			);
			console.error('Failed to update AutoModerator config:', caughtError);
		}
	};

	return (
		<div className="space-y-6">
			{actionError && (
				<p className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger" role="alert">
					{actionError}
				</p>
			)}

			{successMessage && (
				<p
					className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent"
					role="status"
				>
					{successMessage}
				</p>
			)}

			<div className="space-y-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<div>
					<h3 className="text-sm font-medium text-primary dark:text-primary-dark">Enforcement</h3>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Whether AutoModerator carries out the actions it decides on. Either way it records what it decided, so a
						server set to simulate still builds a history you can read back. This setting only applies to a development
						deployment -- in production AutoModerator always acts for real.
					</p>
					<div
						aria-label="Enforcement mode"
						className="mt-2 inline-flex gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
						role="group"
					>
						{DRY_RUN_CHOICES.map((choice) => (
							<Button
								aria-pressed={dryRun === choice}
								className={cn(
									'rounded px-4 py-1.5 text-sm font-medium transition-colors',
									dryRun === choice
										? 'bg-misc-accent text-accent shadow-sm'
										: 'text-secondary hover:bg-on-secondary/50 dark:text-secondary-dark dark:hover:bg-on-secondary-dark/50',
								)}
								key={String(choice)}
								onPress={() => {
									setDryRun(choice);
									setSuccessMessage(null);
								}}
								type="button"
							>
								{DRY_RUN_LABELS.get(choice)}
							</Button>
						))}
					</div>
					<p className="mt-2 text-sm text-secondary dark:text-secondary-dark">{DRY_RUN_DESCRIPTIONS.get(dryRun)}</p>
				</div>
			</div>

			<Button
				className="px-3 py-2.5 bg-misc-accent text-accent rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
				onPress={handleSave}
				type="button"
			>
				Save Changes
			</Button>
		</div>
	);
}
