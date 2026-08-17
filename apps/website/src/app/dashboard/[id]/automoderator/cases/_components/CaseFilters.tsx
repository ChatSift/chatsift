'use client';

import { useEffect, useRef, useState } from 'react';
import { ACTION_LABELS, CASE_ACTIONS } from './caseDisplay';
import { Button } from '@/components/common/Button';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';
import { useURLParam } from '@/hooks/useURLParam';
import { cn } from '@/utils/util';

/**
 * Filter state lives in the URL, not React state, so a filtered view is shareable and survives back/forward --
 * the convention every list page here follows via `useURLParam`.
 */
export function useActionFilter(): string | undefined {
	const [action] = useURLParam('action');
	return action && CASE_ACTIONS.includes(action as (typeof CASE_ACTIONS)[number]) ? action : undefined;
}

export function useIncludePardonedFilter(): boolean {
	const [includePardoned] = useURLParam('include_pardoned');
	return includePardoned === 'true';
}

export function ActionFilter() {
	const action = useActionFilter();
	const [, setAction] = useURLParam('action');
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
		setAction(next ?? null);
		setIsOpen(false);
	};

	return (
		<div className="relative" ref={ref}>
			<Button
				className="flex items-center gap-2 rounded-lg border border-on-secondary px-3 py-2 text-sm text-primary dark:border-on-secondary-dark dark:text-primary-dark"
				onPress={() => setIsOpen((open) => !open)}
			>
				{action ? ACTION_LABELS[action] : 'All actions'}
				<SvgChevronDown className={cn('transition-transform', isOpen && 'rotate-180')} size={14} />
			</Button>

			{isOpen && (
				<div className="absolute z-10 mt-1 flex w-44 flex-col rounded-lg border border-on-secondary bg-card p-1 shadow-lg dark:border-on-secondary-dark dark:bg-card-dark">
					<Button
						className={cn(
							'rounded-md px-3 py-2 text-left text-sm hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark',
							action ? 'text-secondary dark:text-secondary-dark' : 'text-primary dark:text-primary-dark',
						)}
						onPress={() => handleSelect(undefined)}
					>
						All actions
					</Button>
					{CASE_ACTIONS.map((candidate) => (
						<Button
							className={cn(
								'rounded-md px-3 py-2 text-left text-sm hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark',
								action === candidate
									? 'text-primary dark:text-primary-dark'
									: 'text-secondary dark:text-secondary-dark',
							)}
							key={candidate}
							onPress={() => handleSelect(candidate)}
						>
							{ACTION_LABELS[candidate]}
						</Button>
					))}
				</div>
			)}
		</div>
	);
}

export function IncludePardonedToggle() {
	const includePardoned = useIncludePardonedFilter();
	const [, setIncludePardoned] = useURLParam('include_pardoned');

	return (
		<Button
			aria-pressed={includePardoned}
			className={cn(
				'rounded-lg border px-3 py-2 text-sm',
				includePardoned
					? 'border-misc-accent text-misc-accent'
					: 'border-on-secondary text-secondary dark:border-on-secondary-dark dark:text-secondary-dark',
			)}
			onPress={() => setIncludePardoned(includePardoned ? null : 'true')}
		>
			Include pardoned warns
		</Button>
	);
}
