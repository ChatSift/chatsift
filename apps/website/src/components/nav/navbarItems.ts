interface NavbarItem {
	readonly href: string;
	readonly name: string;
}

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
