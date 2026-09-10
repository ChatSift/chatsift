'use client';

import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { SvgDiscord } from '@chatsift/web-core/components/icons/SvgDiscord';
import { loginHref } from '@/api/routes/appeals';

interface SignInPromptProps {
	/**
	 * Where the login returns to. Re-validated server-side against this site's origin and its short path
	 * allowlist (`sanitizeAppealsRedirectTo`), so a value from the URL bar cannot bounce anybody off-site.
	 */
	readonly redirectTo: string;
	readonly subtitle: string;
	readonly title: string;
}

/**
 * The signed-out state of every page that needs a session, and the reason it is one component: signing in is
 * the only thing an appellant can do on any of them, so it gets the whole screen rather than a link tucked
 * under a heading. Three pages rendering that three slightly different ways is how the primary action ends up
 * looking secondary on two of them.
 */
export function SignInPrompt({ title, subtitle, redirectTo }: SignInPromptProps) {
	return (
		<section className="flex flex-col items-center gap-6 py-12 text-center">
			<h1 className="max-w-2xl text-4xl font-medium leading-tight text-primary dark:text-primary-dark">{title}</h1>
			<p className="max-w-xl text-lg text-secondary dark:text-secondary-dark">{subtitle}</p>
			<a className={`${buttonClass('primary')} flex items-center gap-2 text-lg`} href={loginHref(redirectTo)}>
				<SvgDiscord className="fill-accent" />
				Sign in with Discord
			</a>
		</section>
	);
}
