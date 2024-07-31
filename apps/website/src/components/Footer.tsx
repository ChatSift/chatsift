'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import Button from '~/components/Button';
import SvgDarkTheme from '~/components/svg/SvgDarkTheme';
import SvgDiscord from '~/components/svg/SvgDiscord';
import SvgGitHub from '~/components/svg/SvgGitHub';
import SvgLightTheme from '~/components/svg/SvgLightTheme';

export default function Footer() {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState<boolean>(false);

	// See https://github.com/pacocoursey/next-themes?tab=readme-ov-file#avoid-hydration-mismatch
	useEffect(() => {
		setMounted(true);
	}, []);

	const ThemeSwitchButton = theme === 'dark' ? <SvgDarkTheme /> : <SvgLightTheme />;

	return (
		<footer className="g-4 mt-auto flex flex-row items-center justify-between gap-4 border-t-2 border-solid border-t-on-secondary px-6 py-3 font-medium dark:border-t-on-secondary-dark">
			<span className="whitespace-nowrap text-secondary dark:text-secondary-dark">© ChatSift, 2022 - Present</span>
			<div className="flex w-full flex-row content-between items-center gap-4">
				<div className="flex flex-row items-center gap-4">
					<a className="flex" href="/github">
						<SvgGitHub />
					</a>
					<a className="flex" href="/support">
						<SvgDiscord />
					</a>
				</div>
				<div className="ml-auto flex flex-row items-center gap-2">
					<p className="text-lg font-medium text-secondary dark:text-secondary-dark">Theme:</p>
					<Button
						form="extraSmall"
						onPress={() => {
							setTheme(theme === 'dark' ? 'light' : 'dark');
						}}
					>
						{mounted ? ThemeSwitchButton : <SvgLightTheme />}
					</Button>
				</div>
			</div>
		</footer>
	);
}
