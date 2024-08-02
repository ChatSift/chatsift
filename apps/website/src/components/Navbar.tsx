'use client';

import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import clsx from 'clsx';
import Link from 'next/link';
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
		<ul className="m-0 hidden list-none p-0 lg:flex">
			<li>
				<Logo />
			</li>

			<div className="mr-6 flex items-center">
				<NavigationMenu.Root className="flex items-center">
					<NavigationMenu.List className="mr-6 flex p-0">
						{headerItems.map((item) => (
							<NavigationMenu.Item key={item.href} className="flex items-center [&>*]:mr-6">
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

			<li className="flex items-center text-lg text-secondary dark:text-secondary-dark md:ml-auto">
				<User />
			</li>
		</ul>
	);
}

function Mobile() {
	const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

	const listClasses = mobileNavOpen ? clsx() : clsx('hidden', 'max-h-0');

	return (
		<NavigationMenu.Root className="relative md:hidden">
			<div className="ml-auto flex items-center justify-between p-2">
				<Logo />
				<Button
					style={{ padding: 12 }}
					onPress={() => setMobileNavOpen(!mobileNavOpen)}
					aria-expanded={mobileNavOpen}
					aria-controls="menu"
					aria-haspopup="true"
				>
					{mobileNavOpen ? <SvgClose /> : <SvgHamburger />}
				</Button>
			</div>
			<NavigationMenu.List
				className={`z-50 mx-4 flex flex-col overflow-hidden bg-base dark:bg-base-dark ${listClasses}`}
			>
				<div className="border-b-2 border-solid border-b-on-secondary py-4 dark:border-b-on-secondary-dark">
					{headerItems.map((item) => (
						<NavigationMenu.Item key={item.href} className="mb-3">
							<a
								data-href={item.href}
								href={item.href}
								onClick={() => setMobileNavOpen(false)}
								className="block cursor-pointer rounded-md bg-on-tertiary px-4 py-3 text-primary dark:bg-on-tertiary-dark dark:text-primary-dark"
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
				'sticky top-0 z-10 flex h-16 w-full flex-col lg:h-auto lg:border-b-2 lg:border-solid lg:border-on-secondary-dark lg:py-4 lg:pl-6 lg:pr-8'
			}
		>
			<Desktop />
			<div>
				<Mobile />
			</div>
		</header>
	);
}
