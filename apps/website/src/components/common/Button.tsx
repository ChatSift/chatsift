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
				'hover:bg-on-tertiary flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-4 py-2 font-medium active:bg-static',
				props.className,
			)}
		>
			{props.children}
		</AriaButton>
	);
}
