'use client';

import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import clsx from 'clsx';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import Button from '~/components/common/Button';
import Logo from '~/components/common/Logo';
import { UserDesktop, UserMobile } from '~/components/header/User';
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
		<ul className="m-0 hidden list-none p-0 md:flex md:items-center md:gap-4">
			<li className="flex items-center">
				<Logo />
			</li>

			<div className="flex items-center">
				<NavigationMenu.Root className="flex items-center">
					<NavigationMenu.List className="flex gap-4 p-0">
						{headerItems.map((item) => (
							<NavigationMenu.Item key={item.href} className="flex items-center">
								<a className="text-secondary hover:text-primary" href={item.href}>
									{item.name}
								</a>
							</NavigationMenu.Item>
						))}
					</NavigationMenu.List>
				</NavigationMenu.Root>
			</div>

			<li className="flex items-center gap-6 text-secondary md:ml-auto">
				<UserDesktop />
			</li>
		</ul>
	);
}

function Mobile() {
	const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

	const listClasses = mobileNavOpen ? clsx() : clsx('hidden', 'max-h-0');

	return (
		<NavigationMenu.Root className="relative bg-base-100 md:hidden">
			<div className="ml-auto flex items-center justify-between">
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
			<NavigationMenu.List className={`z-50 flex flex-col overflow-hidden ${listClasses}`}>
				<div className="border-b-2 border-solid border-static py-4">
					{headerItems.map((item) => (
						<NavigationMenu.Item key={item.href}>
							<a
								data-href={item.href}
								href={item.href}
								onClick={() => setMobileNavOpen(false)}
								className="bg-on-tertiary block cursor-pointer rounded-md px-4 py-2 text-primary"
							>
								{item.name}
							</a>
						</NavigationMenu.Item>
					))}
				</div>

				<NavigationMenu.Item key="login" className="py-4">
					<UserMobile />
				</NavigationMenu.Item>
			</NavigationMenu.List>
		</NavigationMenu.Root>
	);
}

export function MobileHeaderOverride({ children }: PropsWithChildren) {
	const [container, setContainer] = useState<Element | null>(null);

	useEffect(() => {
		if (!container) {
			setContainer(document.querySelector('#mobile-override-container'));
			console.log(container);
		}
	}, [container]);

	useEffect(() => {
		if (!container) {
			return;
		}

		container.classList.add('hide-for-mobile-override');

		return () => container.classList.remove('hide-for-mobile-override');
	}, [container]);

	if (!container) {
		return null;
	}

	return createPortal(children, container);
}

export default function Navbar() {
	return (
		<header className={'sticky top-0 z-10 flex h-fit w-full flex-col p-2 md:px-4'}>
			<Desktop />
			<div id="mobile-override-container">
				<Mobile />
			</div>
		</header>
	);
}
