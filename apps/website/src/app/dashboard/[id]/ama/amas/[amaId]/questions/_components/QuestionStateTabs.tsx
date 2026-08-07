'use client';

import { Button } from '@/components/common/Button';
import { useURLParam } from '@/hooks/useURLParam';
import { cn } from '@/utils/util';

/**
 * Mods and guests now review the same single queue, so there's just one "Pending Review" tab. "Guest
 * Questions" is the `APPROVED` state -- once prepared answers hold a question there, it's a guest's job
 * to write the answer and send it, so the label describes who acts on it rather than the raw state name.
 * Defaults to "All" -- with mods and guests sharing the queue, there's no single stage that's obviously
 * the one needing attention the way "Pending (Mod)" used to be.
 */
const TABS = [
	{ id: 'all', label: 'All', states: undefined },
	{ id: 'pending', label: 'Pending Review', states: 'PENDING_REVIEW' },
	{ id: 'denied', label: 'Denied', states: 'DENIED' },
	{ id: 'guest-questions', label: 'Guest Questions', states: 'APPROVED' },
	{ id: 'asked', label: 'Asked Questions', states: 'ASKED' },
] as const;

const DEFAULT_TAB_ID = 'all';

/**
 * Falls back to `DEFAULT_TAB_ID` for a missing/unknown tab id (no `tab` param yet, or a stale one from
 * before a tab was renamed/removed) -- shared so the filter actually applied and the tab shown as
 * active can never disagree with each other.
 */
function resolveTabId(tab: string | null): (typeof TABS)[number]['id'] {
	return (TABS.find((t) => t.id === tab) ?? TABS.find((t) => t.id === DEFAULT_TAB_ID)!).id;
}

export function useQuestionStateFilter(): string | undefined {
	const [tab] = useURLParam('tab');
	return TABS.find((t) => t.id === resolveTabId(tab))?.states;
}

export function QuestionStateTabs() {
	const [tab, setTab] = useURLParam('tab');
	const active = resolveTabId(tab);

	return (
		<div className="flex flex-wrap gap-2">
			{TABS.map((t) => (
				<Button
					aria-pressed={active === t.id}
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
