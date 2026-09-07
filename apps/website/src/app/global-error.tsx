'use client';

import { useEffect } from 'react';
import { reportError } from '@/api/report';

import '@/styles/globals.css';

/**
 * The last line of defence (#386): the boundary for a throw in the root layout itself. When this renders,
 * Next has discarded the entire tree including `layout.tsx`, so it has to supply its own `<html>` and
 * `<body>` and import the stylesheet directly -- nothing above it exists to do either.
 *
 * Deliberately dependency-free beyond `reportError`. No `Providers`, no jotai store, no react-query, no
 * `Button`: whatever broke was severe enough to take the layout with it, so anything imported here is
 * something that can break the error page too.
 *
 * **Light-mode tokens only, and no `dark:` variants.** `Providers` is what mounts `next-themes`, and it is
 * gone here -- so the `.dark` class is never applied to `<html>` and every `dark:` utility silently does
 * nothing. Writing them would not fail a build or a lint; it would just quietly render the wrong colours for
 * half the users. Same class of silent failure `docs/frontend.md` warns about for the disabled palette.
 */
export default function GlobalError({ error }: { readonly error: Error & { readonly digest?: string } }) {
	useEffect(() => {
		reportError(error, { source: 'global-boundary', digest: error.digest });
	}, [error]);

	return (
		<html lang="en">
			<body className="bg-base">
				<div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
					<p className="text-2xl font-medium text-primary">Something went wrong</p>
					<p className="max-w-md text-lg text-secondary">
						ChatSift hit an unexpected error and could not render this page.
					</p>
					{error.digest && (
						<p className="text-sm text-secondary">
							Reference: <code className="font-mono">{error.digest}</code>
						</p>
					)}
					{/*
						A plain anchor, not `Link` or `Button`. Router and client bundle are both suspect at this
						point, and a full document load is the one navigation that cannot depend on either.
					*/}
					<a className="mt-3 rounded-md bg-misc-accent px-5 py-2.5 text-lg font-medium text-accent" href="/">
						Return home
					</a>
				</div>
			</body>
		</html>
	);
}
