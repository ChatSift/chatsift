import { NavbarDesktop } from './NavbarDesktop';
import { NavbarMobile } from './NavbarMobile';

export function Navbar() {
	return (
		<header className="sticky top-0 z-50 flex h-16 w-full flex-col bg-base dark:bg-base-dark lg:h-auto lg:border-b-2 lg:border-solid lg:dark:border-on-secondary-dark lg:border-on-secondary lg:py-4 lg:pl-6 lg:pr-8">
			<NavbarDesktop />
			<div id="mobile-override-container">
				<NavbarMobile />
			</div>
		</header>
	);
}
