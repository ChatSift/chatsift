import type { PropsWithChildren, ReactNode } from 'react';

interface NavbarShellProps {
	/**
	 * The `lg:hidden` half. Rendered inside `#mobile-override-container`, which exists so a page can portal its
	 * own header over the mobile nav (`apps/website`'s `MobileHeaderOverride`) -- harmless for an app that
	 * never does.
	 */
	readonly mobile: ReactNode;
}

/**
 * The site header every app on this substrate wears: sticky, full-bleed, and bordered only from `lg` up, where
 * the desktop nav replaces the mobile one.
 *
 * Full-bleed with its own padding rather than a centred `max-w` container, deliberately -- the mark sits against
 * the left edge of the viewport and the account against the right, which is what makes the dashboard's header
 * read as a header rather than as the top of the page content. An app that centres its `<main>` still centres
 * it; the two are not the same box.
 */
export function NavbarShell({ children, mobile }: PropsWithChildren<NavbarShellProps>) {
	return (
		<header className="sticky top-0 z-50 flex h-16 w-full flex-col bg-base lg:h-auto lg:border-b-2 lg:border-solid lg:border-on-secondary lg:py-4 lg:pl-6 lg:pr-8 dark:bg-base-dark lg:dark:border-on-secondary-dark">
			{children}
			{/*
				`lg:hidden` on the container as well as on the nav inside it: the sheet already hides itself, but
				this is a flex-column child of the header, and an empty-but-present box here is exactly the kind of
				thing that quietly adds height to a row that is supposed to be one line.
			*/}
			<div className="lg:hidden" id="mobile-override-container">
				{mobile}
			</div>
		</header>
	);
}
