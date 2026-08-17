'use client';

import { useEffect, useRef, useState } from 'react';
import { REPORT_STATES, STATE_LABELS } from './reportDisplay';
import type { ReportStateName } from '@/api/routes/automoderatorReports';
import { Button } from '@/components/common/Button';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';
import { useURLParam } from '@/hooks/useURLParam';
import { cn } from '@/utils/util';

/**
 * Filter state lives in the URL, not React state, so a filtered view is shareable and survives back/forward --
 * the convention every list page here follows via `useURLParam`. Same shape as `CaseFilters.tsx`.
 */
export function useStateFilter(): ReportStateName | undefined {
	const [state] = useURLParam('state');
	// The `includes` narrowing is what makes the cast safe -- a hand-edited `?state=` in the URL is arbitrary
	// text, and passing it through would fail the route's schema rather than just showing nothing.
	return state && REPORT_STATES.includes(state as ReportStateName) ? (state as ReportStateName) : undefined;
}

export function StateFilter() {
	const state = useStateFilter();
	const [, setState] = useURLParam('state');
	const [isOpen, setIsOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen]);

	const handleSelect = (next: string | undefined) => {
		setState(next ?? null);
		setIsOpen(false);
	};

	return (
		<div className="relative" ref={ref}>
			<Button
				className="flex items-center gap-2 rounded-lg border border-on-secondary px-3 py-2 text-sm text-primary dark:border-on-secondary-dark dark:text-primary-dark"
				onPress={() => setIsOpen((open) => !open)}
			>
				{state ? STATE_LABELS[state] : 'All reports'}
				<SvgChevronDown className={cn('transition-transform', isOpen && 'rotate-180')} size={14} />
			</Button>

			{isOpen && (
				<div className="absolute z-10 mt-1 flex w-44 flex-col rounded-lg border border-on-secondary bg-card p-1 shadow-lg dark:border-on-secondary-dark dark:bg-card-dark">
					<Button
						className={cn(
							'rounded-md px-3 py-2 text-left text-sm hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark',
							state ? 'text-secondary dark:text-secondary-dark' : 'text-primary dark:text-primary-dark',
						)}
						onPress={() => handleSelect(undefined)}
					>
						All reports
					</Button>
					{REPORT_STATES.map((candidate) => (
						<Button
							className={cn(
								'rounded-md px-3 py-2 text-left text-sm hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark',
								state === candidate ? 'text-primary dark:text-primary-dark' : 'text-secondary dark:text-secondary-dark',
							)}
							key={candidate}
							onPress={() => handleSelect(candidate)}
						>
							{STATE_LABELS[candidate]}
						</Button>
					))}
				</div>
			)}
		</div>
	);
}
