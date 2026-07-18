'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Reads/writes a single query-string param, replacing the current history entry. Centralizes the
 * read-searchParams / mutate / push-new-url boilerplate that filter/sort controls (`IncludeEndedToggle`,
 * `SortMenu`, ...) all need — keeps list-page state consistently URL-driven (shareable, survives back/forward)
 * without each control reimplementing the same `URLSearchParams` dance.
 */
export function useURLParam(key: string): readonly [string | null, (value: string | null) => void] {
	const searchParams = useSearchParams();
	const pathname = usePathname();
	const router = useRouter();

	const value = searchParams.get(key);

	const setValue = useCallback(
		(next: string | null) => {
			const params = new URLSearchParams(searchParams);
			if (next === null) {
				params.delete(key);
			} else {
				params.set(key, next);
			}

			const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
			router.replace(newUrl);
		},
		[key, pathname, router, searchParams],
	);

	return [value, setValue] as const;
}
