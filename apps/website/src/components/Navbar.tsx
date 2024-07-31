'use client';

import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import clsx from 'clsx';
import { useState } from 'react';
import Logo from './Logo';
import SvgClose from './svg/SvgClose';
import SvgHamburger from './svg/SvgHamburger';
import Button from '~/components/Button';

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

function Desktop() {
	return (
		<ul className="hidden lg:flex p-0 m-0 list-none">
			<li>
				<Logo />
			</li>

			<li className="flex items-center mr-6">
				<NavigationMenu.Root className="flex items-center">
					<NavigationMenu.List className="flex p-0 mr-6">
						{headerItems.map((item) => (
							<NavigationMenu.Item key={item.href} className="flex items-center [&>*]:mr-6">
								<a className="text-zinc-500 dark:text-zinc-400" href={item.href}>
									{item.name}
								</a>
							</NavigationMenu.Item>
						))}
					</NavigationMenu.List>
				</NavigationMenu.Root>
			</li>

			<li className="flex items-center mr-6 ml-auto gap-6 text-zinc-500 dark:text-zinc-400">
				<a>Log in</a>
			</li>
		</ul>
	);
}

function Mobile() {
	const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

	const listClasses = mobileNavOpen ? clsx() : clsx('hidden', 'max-h-0');

	return (
		<NavigationMenu.Root className="md:hidden relative bg-zinc-100 dark:bg-zinc-900">
			<div className="flex items-center justify-between ml-auto p-2 bg-zinc-100 dark:bg-zinc-900">
				<Logo />
				<Button
					style={{ padding: 12 }}
					onPress={() => setMobileNavOpen(!mobileNavOpen)}
					aria-expanded={mobileNavOpen}
					aria-controls="menu"
					aria-haspopup="true"
				>
					{mobileNavOpen ? (
						<SvgClose className="fill-secondary dark:fill-secondary-dark" />
					) : (
						<SvgHamburger className="fill-secondary dark:fill-secondary-dark" />
					)}
				</Button>
			</div>
			<NavigationMenu.List
				className={`overflow-hidden flex flex-col z-10 bg-zinc-100 dark:bg-zinc-900 mx-4 ${listClasses}`}
			>
				{headerItems.map((item) => (
					<NavigationMenu.Item key={item.href} className="mb-3">
						<a
							data-href={item.href}
							href={item.href}
							onClick={() => setMobileNavOpen(false)}
							className="px-4 py-3 bg-on-tertiary dark:bg-on-tertiary-dark rounded-md cursor-pointer block text-primary dark:text-primary-dark"
						>
							{item.name}
						</a>
					</NavigationMenu.Item>
				))}
			</NavigationMenu.List>

			{/* TODO: Login */}
		</NavigationMenu.Root>
	);
}

export default function Navbar() {
	return (
		<header
			className={
				'sticky top-0 flex flex-col bg-zinc-100 dark:bg-zinc-900 w-full z-50 lg:h-auto lg:border-b-2 lg:border-solid lg:border-on-secondary-dark lg:py-4 lg:pl-6 lg:pr-8 md:h-16'
			}
		>
			<Desktop />
			<div>
				<Mobile />
			</div>
		</header>
	);
}
