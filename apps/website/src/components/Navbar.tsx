'use client';

import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import clsx from 'clsx';
import { useState } from 'react';
import Button from '~/components/Button';
import Logo from '~/components/Logo';
import User from '~/components/User';
import SvgClose from '~/components/svg/SvgClose';
import SvgHamburger from '~/components/svg/SvgHamburger';

const headerItems = [
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
] as const satisfies { href: `/${string}`; name: string }[];

function Desktop() {
	return (
		<ul className="hidden lg:flex p-0 m-0 list-none">
			<li>
				<Logo />
			</li>

			<div className="flex items-center mr-6">
				<NavigationMenu.Root className="flex items-center">
					<NavigationMenu.List className="flex p-0 mr-6">
						{headerItems.map((item) => (
							<NavigationMenu.Item key={item.href} className="flex items-center [&>*]:mr-6">
								<a
									className="text-secondary dark:text-secondary-dark hover:text-primary dark:hover:text-primary-dark text-lg font-medium"
									href={item.href}
								>
									{item.name}
								</a>
							</NavigationMenu.Item>
						))}
					</NavigationMenu.List>
				</NavigationMenu.Root>
			</div>

			<li className="flex items-center md:ml-auto text-secondary dark:text-secondary-dark text-lg">
				<User />
			</li>
		</ul>
	);
}

function Mobile() {
	const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

	const listClasses = mobileNavOpen ? clsx() : clsx('hidden', 'max-h-0');

	return (
		<NavigationMenu.Root className="md:hidden relative">
			<div className="flex items-center justify-between ml-auto p-2">
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
				className={`overflow-hidden flex flex-col z-50 mx-4 bg-base dark:bg-base-dark ${listClasses}`}
			>
				<div className="border-b-on-secondary dark:border-b-on-secondary-dark border-b-2 border-solid py-4">
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
				</div>

				<NavigationMenu.Item key="login" className="py-4">
					<User />
				</NavigationMenu.Item>
			</NavigationMenu.List>
		</NavigationMenu.Root>
	);
}

export default function Navbar() {
	return (
		<header
			className={
				'sticky top-0 flex flex-col w-full z-10 lg:h-auto lg:border-b-2 lg:border-solid lg:border-on-secondary-dark lg:py-4 lg:pl-6 lg:pr-8 h-16'
			}
		>
			<Desktop />
			<div>
				<Mobile />
			</div>
		</header>
	);
}
