import { ThemeSwitchButton } from './ThemeSwitchButton';
import SvgDiscord from '@/components/icons/SvgDiscord';
import { SvgGitHub } from '@/components/icons/SvgGitHub';

export function Footer() {
	return (
		<footer className="g-4 flex flex-row items-center justify-between gap-4 border-t-2 border-solid border-t-on-secondary px-6 py-3 font-medium dark:border-t-on-secondary-dark">
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
					<ThemeSwitchButton />
				</div>
			</div>
		</footer>
	);
}
