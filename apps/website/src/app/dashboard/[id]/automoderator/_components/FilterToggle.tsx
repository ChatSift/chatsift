'use client';

import { useState } from 'react';
import { APIError } from '@/api/error';
import { Button } from '@/components/common/Button';
import { cn } from '@/utils/util';

const CHOICES = [
	{ value: true, label: 'On' },
	{ value: false, label: 'Off' },
] as const;

/**
 * The on/off switch shared by the URL and invite filter pages (P5b).
 *
 * A two-button group rather than a checkbox, matching the enforcement control on the config page -- the
 * dashboard has no switch component and inventing one for two call sites would be a third pattern for the same
 * question.
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
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<h3 className="text-sm font-medium text-primary dark:text-primary-dark">{label}</h3>

				<div
					aria-label={label}
					className="inline-flex gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
					role="group"
				>
					{CHOICES.map((choice) => (
						<Button
							aria-pressed={isEnabled === choice.value}
							className={cn(
								'rounded px-4 py-1.5 text-sm font-medium transition-colors',
								isEnabled === choice.value
									? 'bg-misc-accent text-accent shadow-sm'
									: 'text-secondary hover:bg-on-secondary/50 dark:text-secondary-dark dark:hover:bg-on-secondary-dark/50',
							)}
							isDisabled={isPending}
							key={String(choice.value)}
							onPress={async () => {
								if (isEnabled === choice.value) {
									return;
								}

								setIsPending(true);
								setError(null);

								try {
									await onChange(choice.value);
								} catch (caughtError) {
									setError(caughtError instanceof APIError ? caughtError.message : 'Failed to save.');
								} finally {
									setIsPending(false);
								}
							}}
							type="button"
						>
							{choice.label}
						</Button>
					))}
				</div>
			</div>

			<p className="text-sm text-secondary dark:text-secondary-dark">{description}</p>
			{error && <p className="text-sm text-misc-danger">{error}</p>}
		</div>
	);
}
