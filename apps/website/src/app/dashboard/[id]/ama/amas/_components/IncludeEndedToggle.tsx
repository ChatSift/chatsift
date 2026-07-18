'use client';

import { Button } from '@/components/common/Button';
import { useURLParam } from '@/hooks/useURLParam';

export function IncludeEndedToggle() {
	const [includeEndedParam, setIncludeEnded] = useURLParam('include_ended');
	const includeEnded = includeEndedParam === 'true';

	return (
		<Button
			aria-pressed={includeEnded}
			className={`h-10 px-4 py-2 border rounded-md transition-colors text-sm ${
				includeEnded
					? 'bg-misc-accent border-misc-accent text-primary-dark'
					: 'border-on-secondary dark:border-on-secondary-dark text-primary dark:text-primary-dark opacity-70'
			}`}
			onPress={() => setIncludeEnded(includeEnded ? null : 'true')}
			type="button"
		>
			Include Ended
		</Button>
	);
}
