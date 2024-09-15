'use client';

import { useTheme } from 'next-themes';
import Button from '~/components/common/Button';
import Skeleton from '~/components/common/Skeleton';
import SvgDarkTheme from '~/components/svg/SvgDarkTheme';
import SvgDiscord from '~/components/svg/SvgDiscord';
import SvgGitHub from '~/components/svg/SvgGitHub';
import SvgLightTheme from '~/components/svg/SvgLightTheme';
import { useIsMounted } from '~/hooks/useIsMounted';

function ThemeSwitchButton() {
	const { theme, setTheme } = useTheme();

	return (
		<Button
			form="extraSmall"
			onPress={() => {
				setTheme(theme === 'light' ? 'dark' : 'light');
			}}
			className="size-8 p-2 text-secondary hover:text-primary"
		>
			{theme === 'light' ? <SvgLightTheme /> : <SvgDarkTheme />}
		</Button>
	);
}

export default function Footer() {
	const isMounted = useIsMounted();

	return (
		<footer className="flex flex-col items-start justify-between gap-2 px-4 py-4 md:flex-row md:items-center md:gap-4 md:px-6">
			<span className="whitespace-nowrap text-secondary">© ChatSift, 2022 - Present</span>
			<div className="flex w-full flex-row content-between items-center gap-4">
				<div className="flex flex-row items-center gap-4">
					<a className="flex text-secondary hover:text-primary" href="/github">
						<SvgGitHub className="size-5" />
					</a>
					<a className="flex text-secondary hover:text-primary" href="/support">
						<SvgDiscord className="size-5" />
					</a>
				</div>
				<div className="ml-auto flex flex-row items-center gap-2">
					<p className="text-secondary">Theme:</p>

					{isMounted ? <ThemeSwitchButton /> : <Skeleton className="size-8" />}
				</div>
			</div>
		</footer>
	);
}
