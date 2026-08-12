'use client';

import { DEFAULT_EMBED_COLOR } from '@chatsift/core';
import { Button } from '@/components/common/Button';

/**
 * `#rrggbb`, the only format `<input type="color">` ever reads or writes -- it silently ignores anything
 * else (shorthand `#rgb`, named colors, `rgb()`), so the hex text input next to it has to be held to the
 * same rule rather than being a free-text field that half-works.
 */
const HEX_COLOR_REGEX = /^#[\da-f]{6}$/i;

export function colorToHex(color: number): string {
	return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * `null` for anything the API's `embedColorSchema` would reject, so a half-typed hex in the text input
 * (`#12`) reads as "no color picked yet" -- which falls back to the default -- instead of being sent as a
 * garbage number.
 */
export function hexToColor(hex: string): number | null {
	if (!HEX_COLOR_REGEX.test(hex.trim())) {
		return null;
	}

	return Number.parseInt(hex.trim().slice(1), 16);
}

export const DEFAULT_EMBED_COLOR_HEX = colorToHex(DEFAULT_EMBED_COLOR);

interface ColorFieldProps {
	readonly error?: string | undefined;
	readonly helper?: React.ReactNode;
	readonly id: string;
	readonly label: string;
	onChange(value: string): void;
	/**
	 * `#rrggbb`. Empty means "no color picked" -- the swatch shows the default that would actually be
	 * posted, and the Reset button disappears, so an untouched form and one explicitly reset to blurple
	 * look the same because they *are* the same.
	 */
	readonly value: string;
}

/**
 * The embed accent-color control shared by every dashboard embed builder (ticket panels, AMA prompts).
 * Pairs the native color picker with a hex text input rather than using either alone: the picker is what
 * anyone actually wants for choosing a color, and the text input is what anyone with a brand hex already
 * in their clipboard wants. Both write the same `#rrggbb` string.
 */
export function ColorField({ id, label, value, onChange, error, helper }: ColorFieldProps) {
	const errorId = `${id}-error`;
	const helperId = `${id}-helper`;
	const describedBy = [helper && helperId, error && errorId].filter(Boolean).join(' ') || undefined;

	// The picker itself can't represent "unset", so it shows whatever the embed would actually be posted
	// with -- the default -- rather than defaulting to black and implying a choice nobody made.
	const swatchValue = HEX_COLOR_REGEX.test(value) ? value : DEFAULT_EMBED_COLOR_HEX;

	return (
		<div>
			<label className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor={id}>
				{label}
			</label>
			<div className="flex items-center gap-2">
				<input
					aria-label={`${label} picker`}
					className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-on-secondary bg-card p-1 dark:border-on-secondary-dark dark:bg-card-dark"
					onChange={(event) => onChange(event.target.value)}
					type="color"
					value={swatchValue}
				/>
				<input
					aria-describedby={describedBy}
					aria-invalid={error ? true : undefined}
					className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 font-mono text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
					id={id}
					maxLength={7}
					onChange={(event) => onChange(event.target.value)}
					placeholder={DEFAULT_EMBED_COLOR_HEX}
					type="text"
					value={value}
				/>
				{value && (
					<Button
						className="h-fit shrink-0 p-0 text-sm text-secondary underline hover:bg-transparent dark:text-secondary-dark"
						onPress={() => onChange('')}
					>
						Reset
					</Button>
				)}
			</div>
			{helper && <div id={helperId}>{helper}</div>}
			{error && (
				<p className="mt-1 text-sm text-misc-danger" id={errorId}>
					{error}
				</p>
			)}
		</div>
	);
}
