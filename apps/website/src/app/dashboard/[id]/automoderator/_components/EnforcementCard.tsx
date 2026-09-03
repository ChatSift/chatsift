'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { SettingCard } from './SettingCard';
import { APIError } from '@/api/error';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { Skeleton } from '@/components/common/Skeleton';

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
		<SettingCard
			control={
				config ? (
					<SegmentedControl
						isDisabled={updateConfig.isPending}
						label="Enforcement mode"
						onChange={async (dryRun) => {
							setSaveError(null);

							try {
								await updateConfig.mutateAsync({ dryRun });
							} catch (caughtError) {
								setSaveError(caughtError instanceof APIError ? caughtError.message : 'Failed to save.');
							}
						}}
						options={CHOICES}
						value={config.dryRun}
					/>
				) : (
					!loadError && <Skeleton className="h-9 w-48 rounded-md" />
				)
			}
			description="Simulating means AutoModerator works out what it would do and records it, but never actually bans, kicks, times anyone out, or deletes anything — so a server set to simulate still builds a history you can read back. This only applies to a development deployment; in production AutoModerator always acts for real."
			error={error}
			title="Enforcement"
		/>
	);
}
