import type { NavbarItem } from '@chatsift/web-core/components/nav/NavbarDesktop';

export const navbarItems = [
	{
		name: 'Dashboard',
		href: '/dashboard',
	},
	{
		name: 'GitHub',
		href: '/github',
	},
	{
		name: 'Support',
		href: '/support',
	},
] as const satisfies readonly NavbarItem[];
