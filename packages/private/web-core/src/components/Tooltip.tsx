'use client';

import type { ReactNode } from 'react';
import { Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';

interface TooltipProps {
	readonly children: ReactNode;
	readonly content: ReactNode;
}

/**
 * Thin wrapper around react-aria-components' `TooltipTrigger`/`Tooltip` -- handles hover/focus
 * triggering, positioning, and dismissal itself; this just applies the shared visual styling.
 */
export function Tooltip({ children, content }: TooltipProps) {
	return (
		<TooltipTrigger closeDelay={0} delay={300}>
			{children}
			<AriaTooltip
				className="max-w-64 text-pretty rounded-md border border-on-secondary bg-card px-2 py-1.5 text-xs text-primary shadow-lg dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
				offset={6}
			>
				{content}
			</AriaTooltip>
		</TooltipTrigger>
	);
}
