'use client';

import { useEffect } from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';
import { reportError } from '@/api/report';
import { Button } from '@/components/common/Button';
import { buttonClass } from '@/components/common/buttonStyles';
import { LinkButton } from '@/components/marketing/LinkButton';

/**
 * Route-level error boundary (#386) -- the first one this app has ever had. Before it, a render-time throw in
 * any client component fell through to Next's built-in default: a bare "Application error: a client-side
 * exception has occurred", with nothing logged anywhere we could see.
 *
 * It renders inside the root layout, so the navbar and footer survive and the user still has the normal ways
 * out of the page. Only a throw in the layout itself escalates to `global-error.tsx`.
 *
 * Not named `Error`, which would shadow the global. Next keys on the default export, not the name.
 */
export default function RouteError({
	error,
	reset,
}: {
	readonly error: Error & { readonly digest?: string };
	reset(): void;
}) {
	useEffect(() => {
		// `digest` is the join key: in production Next has already replaced a server-thrown error's message
		// with a generic one by the time it reaches here, and the event carrying the real stack comes from
		// `onRequestError` in `instrumentation.ts`. Nothing else relates the two.
		reportError(error, { source: 'boundary', digest: error.digest });
	}, [error]);

	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
			<FaExclamationTriangle className="h-10 w-10 text-misc-danger" />
			<p className="text-2xl font-medium text-primary dark:text-primary-dark">Something went wrong</p>
			<p className="max-w-md text-lg text-secondary dark:text-secondary-dark">
				This page hit an unexpected error. It has been reported to us automatically.
			</p>
			{/*
				Shown rather than hidden: it is the one thing that makes a user's report actionable, since the
				message itself is generic in production. Harmless to expose -- it is a hash, not a stack.
			*/}
			{error.digest && (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Reference: <code className="font-mono">{error.digest}</code>
				</p>
			)}
			<div className="mt-3 flex flex-col gap-3 sm:flex-row">
				<Button className={buttonClass('primary')} onPress={() => reset()}>
					Try again
				</Button>
				{/*
					Same reasoning as `not-found.tsx`: a plain `Link`, so the way out still works even when whatever
					broke is in the client bundle that renders `Button`.
				*/}
				<LinkButton href="/" variant="ghost">
					Return home
				</LinkButton>
			</div>
		</div>
	);
}
