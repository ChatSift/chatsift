import { NavbarDesktop } from '@chatsift/web-core/components/nav/NavbarDesktop';
import { NavbarMobile } from '@chatsift/web-core/components/nav/NavbarMobile';
import { NavbarShell } from '@chatsift/web-core/components/nav/NavbarShell';
import { AdminNavLink } from './AdminNavLink';
import { navbarItems } from './navbarItems';
import { UserDesktop } from '@/components/user/UserDesktop';
import { UserMobile } from '@/components/user/UserMobile';

export function Navbar() {
	return (
		<NavbarShell
			mobile={
				<NavbarMobile
					account={<UserMobile />}
					extraItems={<AdminNavLink mobile />}
					items={navbarItems}
					label="ChatSift"
				/>
			}
		>
			<NavbarDesktop account={<UserDesktop />} extraItems={<AdminNavLink />} items={navbarItems} label="ChatSift" />
		</NavbarShell>
	);
}
