'use client';

import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { navbarItems } from './navbarItems';
import { Button } from '@/components/common/Button';
import { Logo } from '@/components/common/Logo';
import { SvgClose } from '@/components/icons/SvgClose';
import { SvgHamburger } from '@/components/icons/SvgHamburger';
import { UserMobile } from '@/components/user/UserMobile';
import { cn } from '@/utils/util';

export function NavbarMobile() {
	const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

	const listClasses = mobileNavOpen ? cn() : cn('hidden', 'max-h-0');
	return (
		<NavigationMenu.Root className="relative bg-base dark:bg-base-dark lg:hidden">
			<div className="ml-auto flex items-center justify-between p-2">
				<Logo />
				<Button
					aria-controls="menu"
					aria-expanded={mobileNavOpen}
					aria-haspopup="true"
					onPress={() => setMobileNavOpen(!mobileNavOpen)}
					style={{ padding: 12 }}
				>
					{mobileNavOpen ? <SvgClose /> : <SvgHamburger />}
				</Button>
			</div>
			<NavigationMenu.List className={`z-50 mx-4 flex flex-col overflow-hidden ${listClasses}`}>
				<div className="border-b-2 border-solid border-b-on-secondary py-4 dark:border-b-on-secondary-dark">
					{navbarItems.map((item) => (
						<NavigationMenu.Item className="mb-3" key={item.href}>
							<a
								className="block cursor-pointer rounded-md bg-on-tertiary px-4 py-3 text-primary dark:bg-on-tertiary-dark dark:text-primary-dark"
								data-href={item.href}
								href={item.href}
								onClick={() => setMobileNavOpen(false)}
							>
								{item.name}
							</a>
						</NavigationMenu.Item>
					))}
				</div>

				<NavigationMenu.Item className="py-4" key="login">
					<UserMobile setMobileNavOpen={setMobileNavOpen} />
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
