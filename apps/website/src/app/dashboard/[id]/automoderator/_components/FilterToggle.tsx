'use client';

import { useState } from 'react';
import { SettingCard } from './SettingCard';
import { APIError } from '@/api/error';
import { SegmentedControl } from '@/components/common/SegmentedControl';

const CHOICES = [
	{ value: true, label: 'On' },
	{ value: false, label: 'Off' },
] as const;

/**
 * The on/off switch shared by the URL and invite filter pages (P5b).
 *
 * Saves immediately rather than behind a Save button. The allowlists on the same pages write immediately too,
 * and a screen where half the controls save on click and half wait for a button is one where somebody
 * eventually turns a filter on and walks away without it.
 */
export function FilterToggle({
	description,
	isEnabled,
	label,
	onChange,
}: {
	readonly description: string;
	readonly isEnabled: boolean;
	readonly label: string;
	onChange(enabled: boolean): Promise<unknown>;
}) {
	const [error, setError] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);

	return (
		<SettingCard
			control={
				<SegmentedControl
					isDisabled={isPending}
					label={label}
					onChange={async (enabled) => {
						setIsPending(true);
						setError(null);

						try {
							await onChange(enabled);
						} catch (caughtError) {
							setError(caughtError instanceof APIError ? caughtError.message : 'Failed to save.');
						} finally {
							setIsPending(false);
						}
					}}
					options={CHOICES}
					value={isEnabled}
				/>
			}
			description={description}
			error={error}
			title={label}
		/>
	);
}
