import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import Logo from './Logo';

const headerItems = [
	{
		name: 'Dashboard',
		href: '/dashboard',
		external: false,
	},
	{
		name: 'GitHub',
		href: '/github',
		external: false,
	},
	{
		name: 'Support',
		href: '/support',
		external: false,
	},
] as const satisfies { external: boolean; href: `/${string}`; name: string }[];

export default function Navbar() {
	return (
		<ul className="flex flex-row w-full">
			<li>
				<Logo />
			</li>

			<li className="flex items-center mr-6">
				<NavigationMenu.Root className="flex items-center">
					<NavigationMenu.List className="flex p-0 mr-6">
						{headerItems.map((item) => (
							<NavigationMenu.Item key={item.href} className="flex items-center [&>*]:mr-6">
								<a className="text-secondary" href={item.href}>
									{item.name}
								</a>
							</NavigationMenu.Item>
						))}
					</NavigationMenu.List>
				</NavigationMenu.Root>
			</li>

			<li className="flex items-center mr-6 ml-auto gap-6">
				<a>Log in</a>
			</li>
		</ul>
	);
}
