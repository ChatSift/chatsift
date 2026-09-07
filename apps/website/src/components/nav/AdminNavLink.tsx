'use client';

import { useMe } from '@/api/routes/auth';

interface AdminNavLinkProps {
	/**
	 * The surrounding navbar's own link styling -- desktop and mobile style theirs differently, and this
	 * renders inside both.
	 */
	readonly className: string;
	onNavigate?(): void;
}

/**
 * Its own client component so neither navbar has to become one: `NavbarDesktop` is a server component, and
 * `useMe()` is the only reason this link needs the client at all.
 *
 * Hiding it from non-admins is discoverability, not access control -- `/admin` bounces them and all three
 * `/v3/experiments` routes require `isGlobalAdmin` regardless.
 */
export function AdminNavLink({ className, onNavigate }: AdminNavLinkProps) {
	const { data: user } = useMe();

	if (!user?.isGlobalAdmin) {
		return null;
	}

	return (
		<a className={className} href="/admin" onClick={onNavigate}>
			Admin
		</a>
	);
}
