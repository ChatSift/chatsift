import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import type { ReactNode } from 'react';
import { SiteLogo } from '../SiteLogo';

export interface NavbarItem {
	readonly href: string;
	readonly name: string;
}

/**
 * The desktop nav link's styling, exported because a link that has to be its own client component to decide
 * whether to render at all (`apps/website`'s `AdminNavLink`) still has to look like the static ones beside it.
 */
export const NAV_LINK_CLASS =
	'text-lg font-medium text-secondary hover:text-primary dark:text-secondary-dark dark:hover:text-primary-dark';

interface NavbarDesktopProps {
	/**
	 * The right-hand side: sign-in, or the account and its sign-out. App-specific by construction -- each app
	 * has its own session and its own `useMe` -- so it arrives as a node rather than as configuration.
	 */
	readonly account: ReactNode;
	/**
	 * Rendered after `items`, for a link whose presence depends on the session and therefore cannot be static.
	 */
	readonly extraItems?: ReactNode;
	readonly items: readonly NavbarItem[];
	readonly label: string;
}

export function NavbarDesktop({ label, items, account, extraItems }: NavbarDesktopProps) {
	return (
		// `items-center`, not the flex default of `stretch`: every child here happens to centre its own contents,
		// so a stretched row *looks* aligned right up until one of them (an avatar, a taller button) is a different
		// height from the rest, at which point they drift apart with nothing in the markup saying why.
		<ul className="m-0 hidden list-none p-0 lg:flex lg:items-center">
			<li className="flex items-center">
				<SiteLogo label={label} />
			</li>

			<div className="mr-6 flex items-center">
				<NavigationMenu.Root className="flex items-center">
					<NavigationMenu.List className="mr-6 flex p-0">
						{items.map((item) => (
							<NavigationMenu.Item className="flex items-center [&>*]:mr-6" key={item.href}>
								<a className={NAV_LINK_CLASS} href={item.href}>
									{item.name}
								</a>
							</NavigationMenu.Item>
						))}
						{extraItems && (
							<NavigationMenu.Item className="flex items-center [&>*]:mr-6">{extraItems}</NavigationMenu.Item>
						)}
					</NavigationMenu.List>
				</NavigationMenu.Root>
			</div>

			<li className="flex items-center gap-6 text-lg text-secondary md:ml-auto dark:text-secondary-dark">{account}</li>
		</ul>
	);
}
