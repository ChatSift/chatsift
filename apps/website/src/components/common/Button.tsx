'use client';

import { useState } from 'react';
import type { ButtonProps } from 'react-aria-components';
import { Button as AriaButton } from 'react-aria-components';
import { APIError } from '@/api/error';
import { pushErrorBanner } from '@/api/errorBanner';
import { cn } from '@/utils/util';

export function Button(props: ButtonProps) {
	const { className, ...rest } = props;
	const [isLoading, setIsLoading] = useState(false);

	return (
		<AriaButton
			{...rest}
			className={cn(
				'disabled:cursor-not-allowed disabled:opacity-50 bg-transparent flex h-fit items-center gap-2 whitespace-nowrap rounded-md px-1.5 py-1.5 text-lg hover:bg-on-tertiary active:bg-on-secondary dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark',
				props.className,
			)}
			isDisabled={props.isDisabled || isLoading}
			onPress={async (event) => {
				if (props.onPress) {
					try {
						setIsLoading(true);
						// eslint-disable-next-line @typescript-eslint/await-thenable, @typescript-eslint/no-confusing-void-expression
						await props.onPress?.(event);
					} catch (error) {
						// Fallback safety net, not the primary error path: handlers that already surface their own
						// inline error UI (form submits with field-level errors, etc.) catch internally and never
						// reach here, so this never double-shows. It only fires for onPress handlers that let a
						// mutation error propagate uncaught — otherwise that'd be a silent failure plus an
						// unhandled promise rejection.
						console.error('Unhandled onPress error:', error);
						pushErrorBanner(error instanceof APIError ? error.message : 'Something went wrong. Please try again.');
					} finally {
						setIsLoading(false);
					}
				}
			}}
		>
			{props.children}
		</AriaButton>
	);
}
