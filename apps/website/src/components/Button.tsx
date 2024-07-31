'use client';

import type { ButtonProps } from 'react-aria-components';
import { Button as AriaButton } from 'react-aria-components';

export default function Button(props: ButtonProps) {
	const { className, ...rest } = props;

	return (
		<AriaButton
			{...rest}
			className={`whitespace-nowrap bg-transparent text-lg rounded-md flex items-center gap-2 h-fit py-3 px-4 hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark active:bg-on-secondary dark:active:bg-on-secondary-dark ${props.className}`}
		>
			{props.children}
		</AriaButton>
	);
}
