import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import { navbarItems } from './navbarItems';
import { Logo } from '@/components/common/Logo';
import { UserDesktop } from '@/components/user/UserDesktop';

export function NavbarDesktop() {
	return (
		<ul className="m-0 hidden list-none p-0 lg:flex">
			<li className="flex items-center">
				<Logo />
			</li>

			<div className="mr-6 flex items-center">
				<NavigationMenu.Root className="flex items-center">
					<NavigationMenu.List className="mr-6 flex p-0">
						{navbarItems.map((item) => (
							<NavigationMenu.Item className="flex items-center [&>*]:mr-6" key={item.href}>
								<a
									className="text-lg font-medium text-secondary hover:text-primary dark:text-secondary-dark dark:hover:text-primary-dark"
									href={item.href}
								>
									{item.name}
								</a>
							</NavigationMenu.Item>
						))}
					</NavigationMenu.List>
				</NavigationMenu.Root>
			</div>

			<li className="flex items-center gap-6 text-lg text-secondary dark:text-secondary-dark md:ml-auto">
				<UserDesktop />
			</li>
		</ul>
	);
}
