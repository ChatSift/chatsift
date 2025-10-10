import Link from 'next/link';
import { ThemeSwitchButton } from './ThemeSwitchButton';
import SvgDiscord from '@/components/icons/SvgDiscord';
import { SvgGitHub } from '@/components/icons/SvgGitHub';

export function Footer() {
	return (
		<footer className="g-4 flex flex-col items-start justify-between gap-3 border-t-2 border-solid border-t-on-secondary px-6 py-3 font-medium sm:flex-row sm:items-center sm:gap-4 dark:border-t-on-secondary-dark">
			<span className="whitespace-nowrap text-secondary dark:text-secondary-dark">© ChatSift, 2022 - Present</span>
			<div className="flex w-full flex-row flex-wrap items-center justify-between gap-3 sm:w-auto sm:gap-4">
				<div className="flex flex-row items-center gap-4">
					<Link className="flex" href="/github">
						<SvgGitHub />
					</Link>
					<Link className="flex" href="/support">
						<SvgDiscord />
					</Link>
				</div>
				<div className="flex flex-row items-center gap-2 sm:ml-auto">
					<p className="text-lg font-medium text-secondary dark:text-secondary-dark">Theme:</p>
					<ThemeSwitchButton />
				</div>
			</div>
		</footer>
	);
}
