'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Closes an open dropdown/picker (`EmojiInput`, `ForumTagSelect`, ...) on a click outside `ref`'s element.
 * Only listens while `isOpen` -- no point paying for a document-wide listener while the picker is already closed.
 *
 * Keeps `onOutside` in a ref rather than the effect's dependency array -- callers pass an inline closure (e.g.
 * `() => setIsOpen(false)`), which would otherwise be a new function every render and force the listener to be
 * torn down and re-added on every render while open.
 */
export function useClickOutside(ref: RefObject<HTMLElement | null>, isOpen: boolean, onOutside: () => void): void {
	const onOutsideRef = useRef(onOutside);
	onOutsideRef.current = onOutside;

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				onOutsideRef.current();
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen, ref]);
}
