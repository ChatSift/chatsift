import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long a copy button says "Copied" before going back to its usual label.
 */
const COPIED_FOR_MS = 2_000;

export interface CopyToClipboard {
	/**
	 * True for two seconds after a write that actually landed, for the button's "Copied" label.
	 */
	readonly copied: boolean;
	/**
	 * Writes `value`, then flips `copied` for two seconds. Never rejects -- see the hook's own note.
	 */
	copy(value: string): Promise<void>;
}

/**
 * The "Copy link" gesture every dashboard surface that hands out a URL uses: write, say "Copied", go quiet.
 *
 * Two things it does that each of the four hand-rolled copies of this did not, and both are the kind of bug
 * that only shows up on somebody else's machine:
 *
 * - **A failed write is swallowed.** `navigator.clipboard` is `undefined` outside a secure context (plain HTTP,
 *   some embedded webviews) and `writeText` can be refused outright, so the obvious `await` throws. Routed
 *   through `Button`'s `onPress` that surfaces as the red error banner, which is a startling thing to show
 *   somebody who pressed Copy -- and useless, because the link is on screen next to the button either way.
 *   Nothing is claimed on failure: `copied` stays false, so the label never lies about what is on the
 *   clipboard.
 * - **The timer is owned.** Cleared on unmount, and cleared before each new one, so leaving the page inside the
 *   window cannot set state on a dead component and a rapid double-press cannot stack timers that cut the
 *   second "Copied" short.
 */
export function useCopyToClipboard(): CopyToClipboard {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (timer.current) {
				clearTimeout(timer.current);
			}
		},
		[],
	);

	const copy = useCallback(async (value: string) => {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			return;
		}

		setCopied(true);

		if (timer.current) {
			clearTimeout(timer.current);
		}

		timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
	}, []);

	return { copied, copy };
}
