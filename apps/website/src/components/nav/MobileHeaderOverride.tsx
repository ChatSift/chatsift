'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portals a page's own header over the mobile nav, using the `#mobile-override-container` slot
 * `@chatsift/web-core`'s `NavbarShell` renders and the `.hide-for-mobile-override` rule in this app's
 * `globals.css`.
 *
 * Nothing imports this today -- it predates the dashboard's breadcrumb, which ended up not needing it. Kept
 * rather than deleted because it is the only consumer of that CSS rule and of the container's id, and dropping
 * it would leave both looking like dead weight in the shared package.
 */
export function MobileHeaderOverride({ children }: PropsWithChildren) {
	const [container, setContainer] = useState<Element | null>(null);

	useEffect(() => {
		if (!container) {
			setContainer(document.querySelector('#mobile-override-container'));
		}
	}, [container]);

	useEffect(() => {
		if (!container) {
			return;
		}

		container.classList.add('hide-for-mobile-override');

		return () => container.classList.remove('hide-for-mobile-override');
	}, [container]);

	if (!container) {
		return null;
	}

	return createPortal(children, container);
}
