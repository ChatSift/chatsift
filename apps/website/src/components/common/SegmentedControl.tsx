'use client';

import { Button } from './Button';
import { cn } from '@/utils/util';

export interface SegmentedControlOption<TValue> {
	readonly disabled?: boolean;
	readonly label: string;
	readonly value: TValue;
}

/**
 * The group needs a name for a screen reader -- the options themselves only say "Raw JSON" or "Off", which
 * means nothing on its own. Either give it one directly, or point at the visible `<span>` already labelling it.
 */
type SegmentedControlLabelling =
	{ readonly label: string; readonly labelledBy?: never } | { readonly label?: never; readonly labelledBy: string };

type SegmentedControlProps<TValue> = SegmentedControlLabelling & {
	readonly isDisabled?: boolean;
	onChange(value: TValue): unknown;
	readonly options: readonly SegmentedControlOption<TValue>[];
	readonly value: TValue;
};

/**
 * A pick-one-of-a-few control: a bordered strip of pills with the current one filled.
 *
 * This markup had been copy-pasted six times (AMA's `PromptModeToggle`, ModMail's `PanelModeToggle`,
 * AutoModerator's `FilterToggle`, its enforcement toggle and its banword-policy switches) and had already
 * drifted -- the report-prompt form's Guided/Raw JSON switch was two loose filled pills built on a raw
 * `<button>`, which is both a different shape from every other mode switch and, because a bare `<button>` has no
 * `cursor: pointer`, one that didn't look clickable. Callers own their pending and error state; this only
 * renders and reports the choice.
 */
export function SegmentedControl<TValue extends boolean | number | string>({
	label,
	labelledBy,
	options,
	value,
	onChange,
	isDisabled = false,
}: SegmentedControlProps<TValue>) {
	return (
		<div
			aria-label={label}
			aria-labelledby={labelledBy}
			// Wraps because the banword form builds one of these out of a guild's AutoMod rules, which is however
			// many they have; every other call site has two options and never reaches a second line.
			className="inline-flex flex-wrap gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
			role="group"
		>
			{options.map((option) => {
				const isSelected = value === option.value;

				return (
					<Button
						aria-pressed={isSelected}
						className={cn(
							'rounded px-4 py-1.5 text-sm font-medium transition-colors',
							isSelected
								? 'bg-misc-accent text-accent shadow-sm'
								: 'text-secondary hover:bg-on-secondary/50 dark:text-secondary-dark dark:hover:bg-on-secondary-dark/50',
						)}
						isDisabled={isDisabled || (option.disabled ?? false)}
						key={String(option.value)}
						onPress={() => (isSelected ? undefined : onChange(option.value))}
						type="button"
					>
						{option.label}
					</Button>
				);
			})}
		</div>
	);
}
