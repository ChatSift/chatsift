'use client';

import { Button } from '@/components/common/Button';
import { useURLParam } from '@/hooks/useURLParam';

/**
 * Closing an AMA only stops new question submissions (#299) -- a closed session is still very much being
 * worked on (triage, answers, exports), so the list shows everything by default and this narrows it down to
 * the ones still taking questions, rather than the other way around.
 */
export function OpenOnlyToggle() {
	const [openOnlyParam, setOpenOnly] = useURLParam('open_only');
	const openOnly = openOnlyParam === 'true';

	return (
		<Button
			aria-pressed={openOnly}
			className={`h-10 px-4 py-2 border rounded-md transition-colors text-sm ${
				openOnly
					? 'bg-misc-accent border-misc-accent text-primary-dark'
					: 'border-on-secondary dark:border-on-secondary-dark text-primary dark:text-primary-dark opacity-70'
			}`}
			onPress={() => setOpenOnly(openOnly ? null : 'true')}
			type="button"
		>
			Hide Closed
		</Button>
	);
}
