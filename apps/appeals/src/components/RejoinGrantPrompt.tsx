'use client';

import { loginHref } from '@/api/routes/appeals';

/**
 * The one thing an appellant can still fix after filing (#232 P6): they asked to be added back automatically,
 * and the account they asked with cannot be added to servers, because they declined `guilds.join` on the
 * consent screen.
 *
 * **Here rather than on the form**, which is where it started and where it was wrong: signing in again is a
 * full round trip to Discord and back to a fresh page, so an appellant who took that advice mid-form lost
 * everything they had typed, and one who ignored it filed an appeal the advice was never repeated on. After
 * submitting there is nothing to lose -- the consent is already recorded against the appeal, and the grant is
 * the only half still missing.
 *
 * Shown only while the appeal is open, since granting it changes nothing once a decision has been made.
 */
export function RejoinGrantPrompt({ guildId }: { readonly guildId: string }) {
	return (
		<p className="rounded-lg border border-misc-warning/40 bg-misc-warning/10 p-3 text-sm text-misc-warning dark:border-misc-warning-dark/40 dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark">
			You asked to be added back to this server automatically if your appeal is accepted, but you did not give us
			permission to add you to servers when you signed in.{' '}
			<a className="underline" href={loginHref(`/g/${guildId}`)}>
				Sign in again
			</a>{' '}
			to grant it -- any time before a decision is made will do, and your appeal stays exactly as you left it.
		</p>
	);
}
