'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import Link from 'next/link';
import { FaExclamationTriangle } from 'react-icons/fa';

/**
 * Route-level error boundary. Renders inside the root layout, so the header survives and the appellant still
 * has a way back.
 *
 * No `reportError` call, unlike the dashboard's twin: `unban.app` has no GlitchTip project of its own yet, so
 * there is nowhere for an event to go. Wiring one up is a follow-up (see the P3 deviations block in
 * docs/roadmap/09-appeals.md), and adding the call before the project exists would only look like coverage.
 */
export default function RouteError({
	error,
	reset,
}: {
	readonly error: Error & { readonly digest?: string };
	reset(): void;
}) {
	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
			<FaExclamationTriangle className="h-10 w-10 text-misc-danger" />
			<p className="text-2xl font-medium text-primary dark:text-primary-dark">Something went wrong</p>
			<p className="max-w-md text-lg text-secondary dark:text-secondary-dark">
				This page hit an unexpected error. Nothing you have submitted has been lost.
			</p>
			{error.digest && (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Reference: <code className="font-mono">{error.digest}</code>
				</p>
			)}
			<div className="mt-3 flex flex-col gap-3 sm:flex-row">
				<Button className={buttonClass('primary')} onPress={() => reset()}>
					Try again
				</Button>
				<Link className={buttonClass('secondary')} href="/">
					Start over
				</Link>
			</div>
		</div>
	);
}
