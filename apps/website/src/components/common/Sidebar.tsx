'use client';

import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import { useDrag } from '@use-gesture/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { config, useSpring } from 'react-spring';
import Button from '~/components/common/Button';
import Logo from '~/components/common/Logo';
import { MobileHeaderOverride } from '~/components/header/Navbar';
import { UserMobile } from '~/components/header/User';
import SvgClose from '~/components/svg/SvgClose';
import SvgHamburger from '~/components/svg/SvgHamburger';
import { cn } from '~/util/util';

interface Props {
	readonly children: ReactNode;
	readonly className?: string;
}

function Desktop({ children, className }: Props) {
	return (
		<nav
			className={cn(
				'hidden w-80 flex-shrink-0 border-r border-solid border-r-secondary p-6 md:flex md:flex-col',
				className,
			)}
		>
			{children}
		</nav>
	);
}

function Mobile({ children, className }: Props) {
	const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

	const restPosition = -300;

	const [{ menuX }, api] = useSpring(() => ({
		menuX: restPosition,
		config: { clamp: true },
		onRest: ({ value: { menuX } }) => {
			if (menuX === restPosition) {
				setMobileNavOpen(false);
			}
		},
	}));

	const open = useCallback(
		({ cancelled }: { cancelled: boolean }) => {
			void api.start({
				menuX: 0,
				immediate: false,
				config: cancelled ? config.wobbly : config.stiff,
			});
		},
		[api],
	);

	useEffect(() => {
		if (mobileNavOpen) {
			open({ cancelled: false });
		}
	}, [mobileNavOpen, open]);

	function close() {
		void api.start({
			menuX: restPosition,
			immediate: false,
			config: config.stiff,
		});
	}

	const bind = useDrag(
		({ last, direction: [dx], velocity: [vx], movement: [mx] }) => {
			if (last) {
				if (mx < restPosition / 2 || (vx > 0.5 && dx < 0)) {
					close();
				} else {
					open({ cancelled: true });
				}

				return;
			}

			void api.start({ menuX: mx, immediate: true });
		},
		{
			from: () => [menuX.get(), 0],
			filterTaps: true,
			bounds: { right: 0 },
		},
	);

	return (
		<div className="block md:hidden">
			<NavigationMenu.Root className="relative bg-base md:hidden">
				<div className="ml-auto flex items-center justify-between p-2">
					<Logo />{' '}
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
			</NavigationMenu.Root>
			<div
				className="fixed left-0 top-0 z-40 h-screen w-screen bg-[#000] md:hidden"
				onClick={() => {
					if (mobileNavOpen) {
						close();
					}
				}}
			/>
			<div
				className={cn(
					'fixed left-0 top-0 z-50 flex h-screen w-80 max-w-[80vw] touch-none flex-col justify-between border-r border-solid border-secondary bg-base',
					className,
				)}
				{...bind()}
			>
				<div className="flex flex-col gap-4 p-6">{children}</div>
				<div className="-z-10 flex w-full flex-row content-between items-center gap-4 border-t border-solid border-on-secondary bg-base p-4">
					<UserMobile />
				</div>
			</div>
		</div>
	);
}

export default function Sidebar({ children, className }: Props) {
	return (
		<>
			<Desktop className={className}>{children}</Desktop>
			<MobileHeaderOverride>
				<Mobile className={className}>{children}</Mobile>
			</MobileHeaderOverride>
		</>
	);
}
