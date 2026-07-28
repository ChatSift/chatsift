'use client';

import { Button } from '@/components/common/Button';
import { useURLParam } from '@/hooks/useURLParam';

export function IncludeClosedToggle() {
	const [includeClosedParam, setIncludeClosed] = useURLParam('include_closed');
	const includeClosed = includeClosedParam === 'true';

	return (
		<Button
			aria-pressed={includeClosed}
			className={`h-10 px-4 py-2 border rounded-md transition-colors text-sm ${
				includeClosed
					? 'bg-misc-accent border-misc-accent text-primary-dark'
					: 'border-on-secondary dark:border-on-secondary-dark text-primary dark:text-primary-dark opacity-70'
			}`}
			onPress={() => setIncludeClosed(includeClosed ? null : 'true')}
			type="button"
		>
			Include Closed
		</Button>
	);
}
