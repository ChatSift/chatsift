import { ThemeSwitchButton } from './ThemeSwitchButton';
import { SvgDiscord } from './icons/SvgDiscord';
import { SvgGitHub } from './icons/SvgGitHub';

interface FooterProps {
	/**
	 * Origin to hang the ChatSift links off, for an app that is not served from `automoderator.app` --
	 * `unban.app` is its own eTLD+1 and has no `/terms`, `/privacy`, `/github` or `/support` route of its own
	 * (#232 decision 3). Defaults to `''`, i.e. same-origin, which is what the dashboard wants.
	 *
	 * Pass it without a trailing slash. `/github` and `/support` are redirects the website defines in its
	 * `next.config.mjs`, so pointing at them rather than at GitHub and the invite directly keeps one place to
	 * change if either moves.
	 */
	readonly siteUrl?: string;
}

export function Footer({ siteUrl = '' }: FooterProps = {}) {
	return (
		<footer className="g-4 flex flex-col items-start justify-between gap-3 border-t-2 border-solid border-t-on-secondary px-3 py-2.5 font-medium sm:flex-row sm:items-center sm:gap-4 dark:border-t-on-secondary-dark">
			<div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1">
				{/*
					On the main site this is just a copyright line -- linking a page to itself is noise. Anywhere
					else (`unban.app`) it is the way back, and the copyright is the natural thing to hang that on:
					it already names the site, so it needs no extra footer item to say the same word twice.
				*/}
				{siteUrl ? (
					<a
						className="whitespace-nowrap text-secondary underline underline-offset-2 dark:text-secondary-dark"
						href={siteUrl}
					>
						© ChatSift, 2022 - Present
					</a>
				) : (
					<span className="whitespace-nowrap text-secondary dark:text-secondary-dark">© ChatSift, 2022 - Present</span>
				)}
				<a
					className="whitespace-nowrap text-secondary underline underline-offset-2 dark:text-secondary-dark"
					href={`${siteUrl}/terms`}
				>
					Terms
				</a>
				<a
					className="whitespace-nowrap text-secondary underline underline-offset-2 dark:text-secondary-dark"
					href={`${siteUrl}/privacy`}
				>
					Privacy
				</a>
			</div>
			<div className="flex w-full flex-row flex-wrap items-center justify-between gap-3 sm:w-auto sm:gap-4">
				<div className="flex flex-row items-center gap-4">
					<a className="flex" href={`${siteUrl}/github`}>
						<SvgGitHub />
					</a>
					<a className="flex" href={`${siteUrl}/support`}>
						<SvgDiscord />
					</a>
				</div>
				<div className="flex flex-row items-center gap-2 sm:ml-auto">
					<p className="text-lg font-medium text-secondary dark:text-secondary-dark">Theme:</p>
					<ThemeSwitchButton />
				</div>
			</div>
		</footer>
	);
}
