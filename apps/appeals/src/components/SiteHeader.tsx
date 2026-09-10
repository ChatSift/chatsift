'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { GenericAvatar } from '@chatsift/web-core/components/GenericAvatar';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { loginHref, useLogout, useMe } from '@/api/routes/appeals';

export function SiteHeader() {
	const { data: user, isPending } = useMe();
	const logout = useLogout();
	const pathname = usePathname();

	return (
		<header className="border-b border-on-secondary dark:border-on-secondary-dark">
			<nav className="mx-auto flex w-[clamp(320px,90vw,880px)] items-center justify-between gap-4 py-4">
				<Link className="text-lg font-medium text-primary dark:text-primary-dark" href="/">
					unban.app
				</Link>

				{isPending ? null : user ? (
					<div className="flex items-center gap-3">
						<Link className="text-sm text-secondary hover:underline dark:text-secondary-dark" href="/appeals">
							Your appeals
						</Link>
						<div className="flex items-center gap-2">
							<GenericAvatar
								assetURL={user.avatarUrl ?? undefined}
								className="h-6 w-6"
								disableLink
								initials={user.displayName.slice(0, 2).toUpperCase()}
								isLoading={false}
							/>
							<span className="text-sm text-primary dark:text-primary-dark">{user.displayName}</span>
						</div>
						<Button className={buttonClass('secondary', 'sm')} onPress={async () => logout.mutateAsync()}>
							Sign out
						</Button>
					</div>
				) : (
					// A full navigation, not a fetch -- the OAuth handshake ends in a redirect back here, and the
					// current path is what it returns to (re-validated server-side, see `loginHref`).
					<a className={buttonClass('primary', 'sm')} href={loginHref(pathname)}>
						Sign in with Discord
					</a>
				)}
			</nav>
		</header>
	);
}
