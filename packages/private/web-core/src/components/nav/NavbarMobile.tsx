'use client';

import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { createContext, useContext, useState } from 'react';
import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { SiteLogo } from '../SiteLogo';
import { SvgClose } from '../icons/SvgClose';
import { SvgHamburger } from '../icons/SvgHamburger';
import type { NavbarItem } from './NavbarDesktop';

/**
 * The mobile sheet's link styling -- a filled row rather than the desktop's bare text. Exported for the same
 * reason `NAV_LINK_CLASS` is: a session-dependent link renders in here too and has to match.
 */
export const MOBILE_NAV_LINK_CLASS =
	'block cursor-pointer rounded-md bg-on-tertiary px-4 py-3 text-primary dark:bg-on-tertiary-dark dark:text-primary-dark';

/**
 * Carries `useState`'s own setter rather than a `close` closure, which matters: a fresh function here would be
 * a new context value on every render, re-rendering every consumer for nothing. The setter is stable by
 * construction, so the provider never needs memoising. `null` is "no sheet in scope".
 */
const NavbarMobileOpenContext = createContext<Dispatch<SetStateAction<boolean>> | null>(null);

/**
 * Puts the mobile sheet away. Anything rendered into `account`/`extraItems` that navigates or signs out should
 * call this, since the sheet has no idea what its slots did.
 *
 * A context rather than a callback prop so the slots stay plain `ReactNode`s -- passing them as render props
 * meant defining a component inside `Navbar`'s render, which React reconciles as a brand-new type every time
 * (and `react/no-unstable-nested-components` rightly rejects). A no-op outside a sheet, so the same component
 * can render in the desktop navbar, where there is nothing to close.
 */
export function useCloseNavbarMobile(): () => void {
	const setOpen = useContext(NavbarMobileOpenContext);
	return () => setOpen?.(false);
}

interface NavbarMobileProps {
	/**
	 * The signed-in account and its sign-out, or the sign-in button. App-specific by construction -- each app
	 * has its own session -- so it arrives as a node rather than as configuration.
	 */
	readonly account: ReactNode;
	/**
	 * Rendered after `items`, for a link whose presence depends on the session and therefore cannot be static.
	 */
	readonly extraItems?: ReactNode;
	readonly items: readonly NavbarItem[];
	readonly label: string;
}

export function NavbarMobile({ label, items, account, extraItems }: NavbarMobileProps) {
	const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);
	const close = () => setMobileNavOpen(false);

	const listClasses = mobileNavOpen ? cn() : cn('hidden', 'max-h-0');
	return (
		<NavbarMobileOpenContext value={setMobileNavOpen}>
			<NavigationMenu.Root className="relative bg-base lg:hidden dark:bg-base-dark">
				<div className="ml-auto flex items-center justify-between p-2">
					<SiteLogo label={label} />
					<Button
						aria-controls="menu"
						aria-expanded={mobileNavOpen}
						aria-haspopup="true"
						className="p-3"
						onPress={() => setMobileNavOpen(!mobileNavOpen)}
					>
						{mobileNavOpen ? <SvgClose /> : <SvgHamburger />}
					</Button>
				</div>
				<NavigationMenu.List className={`z-50 mx-4 flex flex-col overflow-hidden ${listClasses}`}>
					<div className="border-b-2 border-solid border-b-on-secondary py-4 dark:border-b-on-secondary-dark">
						{items.map((item) => (
							<NavigationMenu.Item className="mb-3" key={item.href}>
								<a className={MOBILE_NAV_LINK_CLASS} data-href={item.href} href={item.href} onClick={close}>
									{item.name}
								</a>
							</NavigationMenu.Item>
						))}
						{extraItems && <NavigationMenu.Item className="mb-3">{extraItems}</NavigationMenu.Item>}
					</div>

					<NavigationMenu.Item className="py-4" key="login">
						{account}
					</NavigationMenu.Item>
				</NavigationMenu.List>
			</NavigationMenu.Root>
		</NavbarMobileOpenContext>
	);
}
