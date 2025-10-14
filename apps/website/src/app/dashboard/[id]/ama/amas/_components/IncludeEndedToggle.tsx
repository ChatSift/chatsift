'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/common/Button';

export function IncludeEndedToggle() {
	const searchParams = useSearchParams();
	const pathname = usePathname();
	const router = useRouter();

	const includeEnded = searchParams.get('include_ended') === 'true';

	const handleToggle = useCallback(() => {
		const params = new URLSearchParams(searchParams);
		if (includeEnded) {
			params.delete('include_ended');
		} else {
			params.set('include_ended', 'true');
		}

		const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
		router.push(newUrl);
	}, [includeEnded, pathname, router, searchParams]);

	return (
		<Button
			className={`h-10 px-4 py-2 border rounded-md transition-colors text-sm ${
				includeEnded
					? 'bg-misc-accent border-misc-accent text-primary-dark'
					: 'border-on-secondary dark:border-on-secondary-dark text-primary dark:text-primary-dark opacity-70'
			}`}
			onPress={handleToggle}
			type="button"
		>
			Include Ended
		</Button>
	);
}
