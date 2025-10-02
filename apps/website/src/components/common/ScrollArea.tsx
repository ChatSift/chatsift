'use client';

import * as ScrollAreaBase from '@radix-ui/react-scroll-area';
import type { ReactNode } from 'react';

interface ScrollAreaProps {
	readonly children: ReactNode;
	readonly className?: string;
	readonly rootClassName?: string;
}

export function ScrollArea({ children, className, rootClassName }: ScrollAreaProps) {
	return (
		<ScrollAreaBase.Root className={rootClassName}>
			<ScrollAreaBase.Viewport className={className}>{children}</ScrollAreaBase.Viewport>
			<ScrollAreaBase.Scrollbar
				className="group bg-card dark:bg-card-dark w-6 bg-clip-padding z-50 border-8 border-solid border-[transparent]"
				orientation="vertical"
			>
				<ScrollAreaBase.Thumb className="bg-on-secondary dark:bg-on-secondary-dark group-hover:bg-on-primary group-hover:dark:bg-on-primary-dark transition-colors rounded-lg" />
			</ScrollAreaBase.Scrollbar>
			<ScrollAreaBase.Scrollbar
				className="group bg-card dark:bg-card-dark w-6 bg-clip-padding z-50 border-8 border-solid border-[transparent]"
				orientation="horizontal"
			>
				<ScrollAreaBase.Thumb className="bg-on-secondary dark:bg-on-secondary-dark group-hover:bg-on-primary group-hover:dark:bg-on-primary-dark transition-colors rounded-lg" />
			</ScrollAreaBase.Scrollbar>
			<ScrollAreaBase.Corner />
		</ScrollAreaBase.Root>
	);
}
