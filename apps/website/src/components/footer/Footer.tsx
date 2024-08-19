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
			className="h-6"
		>
			{theme === 'light' ? <SvgLightTheme /> : <SvgDarkTheme />}
		</Button>
	);
}

export default function Footer() {
	const isMounted = useIsMounted();

	return (
		<footer className="g-4 flex flex-row items-center justify-between gap-4 border-t-2 border-solid border-t-on-secondary px-6 py-3 font-medium">
			<span className="whitespace-nowrap text-secondary">© ChatSift, 2022 - Present</span>
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
					<p className="text-lg font-medium text-secondary">Theme:</p>

					{isMounted ? <ThemeSwitchButton /> : <Skeleton className="h-6 w-9" />}
				</div>
			</div>
		</footer>
	);
}
