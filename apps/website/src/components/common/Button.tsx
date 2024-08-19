'use client';

import type { ButtonProps } from 'react-aria-components';
import { Button as AriaButton } from 'react-aria-components';
import { cn } from '~/util/util';

export default function Button(props: ButtonProps) {
	const { className, ...rest } = props;

	return (
		<AriaButton
			{...rest}
			className={cn(
				'flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg hover:bg-on-tertiary active:bg-on-secondary',
				props.className,
			)}
		>
			{props.children}
		</AriaButton>
	);
}
