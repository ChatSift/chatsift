'use client';

import { Button } from '@/components/common/Button';
import { useURLParam } from '@/hooks/useURLParam';
import { cn } from '@/utils/util';

/**
 * Mod review and guest review are different people acting in different places -- lumping them into one
 * "Pending" tab hid which queue a question was actually waiting on. FLAGGED gets its own tab too, rather
 * than being folded into "Pending (Mod)" -- it's a deliberately separate track (a mod pulling a question
 * aside for extra scrutiny), not just more mod-queue backlog. Defaults to "Pending (Mod)" -- that's the
 * queue that actually needs a mod's attention day to day, unlike "All", which buries it under everything
 * else.
 */
const TABS = [
	{ id: 'all', label: 'All', states: undefined },
	{ id: 'pending-mod', label: 'Pending (Mod)', states: 'PENDING_MOD_REVIEW' },
	{ id: 'pending-guest', label: 'Pending (Guest)', states: 'PENDING_GUEST_REVIEW' },
	{ id: 'flagged', label: 'Flagged', states: 'FLAGGED' },
	{ id: 'approved', label: 'Approved', states: 'APPROVED' },
	{ id: 'asked', label: 'Asked', states: 'ASKED' },
	{ id: 'denied', label: 'Denied', states: 'DENIED' },
] as const;

const DEFAULT_TAB_ID = 'pending-mod';

export function useQuestionStateFilter(): string | undefined {
	const [tab] = useURLParam('tab');
	return TABS.find((t) => t.id === (tab ?? DEFAULT_TAB_ID))?.states;
}

export function QuestionStateTabs() {
	const [tab, setTab] = useURLParam('tab');
	const active = TABS.find((t) => t.id === tab)?.id ?? DEFAULT_TAB_ID;

	return (
		<div className="flex flex-wrap gap-2">
			{TABS.map((t) => (
				<Button
					className={cn(
						'h-10 border border-on-secondary px-3 text-sm text-primary dark:border-on-secondary-dark dark:text-primary-dark',
						active === t.id && 'bg-misc-accent/10 text-misc-accent dark:text-misc-accent',
					)}
					key={t.id}
					onPress={() => setTab(t.id)}
					type="button"
				>
					{t.label}
				</Button>
			))}
		</div>
	);
}
