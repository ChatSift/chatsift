'use client';

import { NAV_LINK_CLASS } from '@chatsift/web-core/components/nav/NavbarDesktop';
import { MOBILE_NAV_LINK_CLASS, useCloseNavbarMobile } from '@chatsift/web-core/components/nav/NavbarMobile';
import { useMe } from '@/api/routes/auth';

interface AdminNavLinkProps {
	/**
	 * Which navbar this is rendering in -- the two style their links differently, and this renders in both.
	 * The classes come from the navbar components themselves so the two can never drift apart.
	 */
	readonly mobile?: boolean;
}

/**
 * Its own client component so neither navbar has to become one: `NavbarDesktop` is a server component, and
 * `useMe()` is the only reason this link needs the client at all.
 *
 * Hiding it from non-admins is discoverability, not access control -- `/admin` bounces them and all three
 * `/v3/experiments` routes require `isGlobalAdmin` regardless.
 */
export function AdminNavLink({ mobile = false }: AdminNavLinkProps) {
	const { data: user } = useMe();
	// A no-op in the desktop navbar, which has no sheet to put away -- see `useCloseNavbarMobile`.
	const closeNavbarMobile = useCloseNavbarMobile();

	if (!user?.isGlobalAdmin) {
		return null;
	}

	return (
		<a className={mobile ? MOBILE_NAV_LINK_CLASS : NAV_LINK_CLASS} href="/admin" onClick={closeNavbarMobile}>
			Admin
		</a>
	);
}
