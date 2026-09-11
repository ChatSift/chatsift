'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { cn } from '@chatsift/web-core/utils/cn';
import { useEffect, useRef, useState } from 'react';
import { APPEAL_STATUSES, STATUS_LABELS } from './appealDisplay';
import type { AppealStatusName } from '@/api/routes/appeals';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';
import { useURLParam } from '@/hooks/useURLParam';

/**
 * Filter state lives in the URL, not React state, so a filtered view is shareable and survives back/forward --
 * the convention every list page here follows via `useURLParam`. Same shape as `ReportFilters.tsx`.
 */
export function useStatusFilter(): AppealStatusName | undefined {
	const [status] = useURLParam('status');
	// The `includes` narrowing is what makes the cast safe -- a hand-edited `?status=` in the URL is arbitrary
	// text, and passing it through would fail the route's schema rather than just showing nothing.
	return status && APPEAL_STATUSES.includes(status as AppealStatusName) ? (status as AppealStatusName) : undefined;
}

export function StatusFilter() {
	const status = useStatusFilter();
	const [, setStatus] = useURLParam('status');
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
		setStatus(next ?? null);
		setIsOpen(false);
	};

	return (
		<div className="relative" ref={ref}>
			<Button
				className="flex items-center gap-2 rounded-lg border border-on-secondary px-3 py-2 text-sm text-primary dark:border-on-secondary-dark dark:text-primary-dark"
				onPress={() => setIsOpen((open) => !open)}
			>
				{status ? STATUS_LABELS[status] : 'All appeals'}
				<SvgChevronDown className={cn('transition-transform', isOpen && 'rotate-180')} size={14} />
			</Button>

			{isOpen && (
				<div className="absolute z-10 mt-1 flex w-52 flex-col rounded-lg border border-on-secondary bg-card p-1 shadow-lg dark:border-on-secondary-dark dark:bg-card-dark">
					<Button
						className={cn(
							'rounded-md px-3 py-2 text-left text-sm hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark',
							status ? 'text-secondary dark:text-secondary-dark' : 'text-primary dark:text-primary-dark',
						)}
						onPress={() => handleSelect(undefined)}
					>
						All appeals
					</Button>
					{APPEAL_STATUSES.map((candidate) => (
						<Button
							className={cn(
								'rounded-md px-3 py-2 text-left text-sm hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark',
								status === candidate
									? 'text-primary dark:text-primary-dark'
									: 'text-secondary dark:text-secondary-dark',
							)}
							key={candidate}
							onPress={() => handleSelect(candidate)}
						>
							{STATUS_LABELS[candidate]}
						</Button>
					))}
				</div>
			)}
		</div>
	);
}
