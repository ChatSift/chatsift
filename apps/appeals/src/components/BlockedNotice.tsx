import type { AppealBlockReason } from '@chatsift/api';

interface BlockedNoticeProps {
	/**
	 * ISO timestamp, only meaningful alongside `'COOLDOWN'`.
	 */
	readonly cooldownUntil: string | null;
	readonly reason: AppealBlockReason;
}

/**
 * Why the form is not on screen, in the appellant's own terms.
 *
 * Two of these are deliberately vaguer than the API's own knowledge:
 *
 * - `'UNAPPEALABLE'` never says why. The guild's moderators write a reason on that list, and it is for them
 *   (decision 8) -- it is not sent to the API's response, let alone here.
 * - `'ALREADY_OPEN'` is also what a silent denial renders as (decision 6), so this copy has to be honest for a
 *   genuinely pending appeal and give nothing away about a closed one.
 */
function describe(reason: AppealBlockReason, cooldownUntil: string | null): { body: string; title: string } {
	switch (reason) {
		case 'NOT_CONFIGURED':
			return {
				title: 'This server does not accept appeals here',
				body: 'The server has not set up appeals through ChatSift. If you were told to appeal somewhere else, use that link instead.',
			};
		case 'PROBE_UNAVAILABLE':
			return {
				title: 'We could not check this server right now',
				body: 'This is usually temporary. Try again in a few minutes -- nothing you do here has been lost.',
			};
		case 'NOT_BANNED':
			return {
				title: 'You are not banned in this server',
				body: 'There is nothing to appeal. If you were banned somewhere else, open the appeal link for that server instead.',
			};
		case 'UNAPPEALABLE':
			return {
				title: 'You cannot appeal in this server',
				body: 'The moderators have decided this ban is not open to appeal.',
			};
		case 'ALREADY_OPEN':
			return {
				title: 'Your appeal is under review',
				body: 'You already have an appeal open in this server. You will be notified when a decision is made.',
			};
		case 'MAX_APPEALS':
			return {
				title: 'You have used all of your appeals here',
				body: 'This server limits how many times the same ban can be appealed, and you have reached that limit.',
			};
		case 'COOLDOWN':
			return {
				title: 'You cannot appeal again yet',
				body: cooldownUntil
					? `This server asks you to wait before appealing again. You can try again on ${new Date(cooldownUntil).toLocaleDateString(undefined, { dateStyle: 'long' })}.`
					: 'This server asks you to wait before appealing again.',
			};
	}
}

export function BlockedNotice({ reason, cooldownUntil }: BlockedNoticeProps) {
	const { title, body } = describe(reason, cooldownUntil);

	return (
		<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-lg font-medium text-primary dark:text-primary-dark">{title}</p>
			<p className="mt-1 text-secondary dark:text-secondary-dark">{body}</p>
		</div>
	);
}
