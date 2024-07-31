'use client';

import type { ButtonProps } from 'react-aria-components';
import { Button as AriaButton } from 'react-aria-components';

export default function Button(props: ButtonProps) {
	const { className, ...rest } = props;

	return (
		<AriaButton
			{...rest}
			className={`bg-transparent flex h-fit items-center gap-2 whitespace-nowrap rounded-md px-4 py-3 text-lg hover:bg-on-tertiary active:bg-on-secondary dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark ${props.className}`}
		>
			{props.children}
		</AriaButton>
	);
}
