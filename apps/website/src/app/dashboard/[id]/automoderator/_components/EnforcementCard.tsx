'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { cn } from '@/utils/util';

const CHOICES = [
	{ value: false, label: 'Act for real' },
	{ value: true, label: 'Simulate only' },
] as const;

/**
 * Enforcement mode, which used to be the whole of a top-level `automoderator/config` page.
 *
 * It lives on the hub now: every other AutoModerator setting sits with the feature it governs, so a "Config"
 * section listed beside Cases and Filters promised server-wide settings and delivered one development-only
 * toggle. Saves on click like `FilterToggle`, rather than behind a Save button it would be the only control on.
 */
export function EnforcementCard() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: config, error: loadError } = useAutomoderatorConfig(guildId);
	const updateConfig = useUpdateAutomoderatorConfig(guildId);

	const [saveError, setSaveError] = useState<string | null>(null);
	// Not `UserErrorHandler`: this is one card at the bottom of the hub, and a failed config read shouldn't
	// replace the section list above it with an error page. A skeleton that never resolves would be the
	// dishonest alternative.
	const error = saveError ?? (loadError && !config ? 'Could not load this setting.' : null);

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<h3 className="text-sm font-medium text-primary dark:text-primary-dark">Enforcement</h3>

				{config ? (
					<div
						aria-label="Enforcement mode"
						className="inline-flex gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
						role="group"
					>
						{CHOICES.map((choice) => (
							<Button
								aria-pressed={config.dryRun === choice.value}
								className={cn(
									'rounded px-4 py-1.5 text-sm font-medium transition-colors',
									config.dryRun === choice.value
										? 'bg-misc-accent text-accent shadow-sm'
										: 'text-secondary hover:bg-on-secondary/50 dark:text-secondary-dark dark:hover:bg-on-secondary-dark/50',
								)}
								isDisabled={updateConfig.isPending}
								key={String(choice.value)}
								onPress={async () => {
									if (config.dryRun === choice.value) {
										return;
									}

									setSaveError(null);

									try {
										await updateConfig.mutateAsync({ dryRun: choice.value });
									} catch (caughtError) {
										setSaveError(caughtError instanceof APIError ? caughtError.message : 'Failed to save.');
									}
								}}
								type="button"
							>
								{choice.label}
							</Button>
						))}
					</div>
				) : (
					!loadError && <Skeleton className="h-9 w-48 rounded-md" />
				)}
			</div>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				Simulating means AutoModerator works out what it would do and records it, but never actually bans, kicks, times
				anyone out, or deletes anything — so a server set to simulate still builds a history you can read back. This
				only applies to a development deployment; in production AutoModerator always acts for real.
			</p>

			{error && <p className="text-sm text-misc-danger">{error}</p>}
		</div>
	);
}
