import { NavbarDesktop } from '@chatsift/web-core/components/nav/NavbarDesktop';
import type { NavbarItem } from '@chatsift/web-core/components/nav/NavbarDesktop';
import { NavbarMobile } from '@chatsift/web-core/components/nav/NavbarMobile';
import { NavbarShell } from '@chatsift/web-core/components/nav/NavbarShell';
import { AppealsUserDesktop } from './user/AppealsUserDesktop';
import { AppealsUserMobile } from './user/AppealsUserMobile';
import { SITE_URL } from '@/utils/site';

/**
 * The same navbar the dashboard wears, from the same components -- `NavbarShell`/`NavbarDesktop`/`NavbarMobile`
 * in `@chatsift/web-core`. What differs is only what cannot be shared: the wordmark, the links, and the account
 * slot, which is typed against this app's session rather than the dashboard's.
 */
const items = [
	{ name: 'Your appeals', href: '/appeals' },
	{ name: 'ChatSift', href: SITE_URL },
	{ name: 'Support', href: `${SITE_URL}/support` },
] as const satisfies readonly NavbarItem[];

export function SiteHeader() {
	return (
		<NavbarShell mobile={<NavbarMobile account={<AppealsUserMobile />} items={items} label="unban.app" />}>
			<NavbarDesktop account={<AppealsUserDesktop />} items={items} label="unban.app" />
		</NavbarShell>
	);
}
