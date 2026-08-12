interface EligibilityExampleProps {
	readonly requiredMessages: number;
	readonly timespanSeconds: number;
	readonly xpGain: number;
}

/**
 * Talks the three tracking settings back as a story about one member, because the rule they combine into isn't
 * obvious from any of them alone: the window is a *batch* requirement and the cooldown at once, and it's measured
 * from the first message of the batch rather than from the grant. Reading that off three number fields is how
 * guilds end up accidentally configuring one grant per hour.
 */
export function EligibilityExample({ requiredMessages, timespanSeconds, xpGain }: EligibilityExampleProps) {
	// Matches `isEligibleForXp`'s own short-circuit: a guild asking for one message never tracks a window at all,
	// so describing cooldowns here would be describing something that doesn't run.
	if (requiredMessages <= 1) {
		return (
			<Panel>
				Every single message earns <Value>{xpGain} XP</Value>, with no window and no cooldown at all -- the setting
				above is what switches that batching off.
			</Panel>
		);
	}

	// A plausible mid-window moment for the story below. Any value under the window works; 40% of it keeps the
	// "and there's still time left on the clock" half true at every window length the API allows.
	const reachedAt = Math.max(1, Math.round(timespanSeconds * 0.4));
	const waitFor = timespanSeconds - reachedAt;
	// One grant per window is the ceiling, since the bar always runs to the end of the window the grant started in.
	const perMinute = (60 / timespanSeconds) * xpGain;

	return (
		<Panel>
			<p>
				Someone has to send <Value>{requiredMessages} messages</Value> within <Value>{timespanSeconds} seconds</Value>{' '}
				to earn <Value>{xpGain} XP</Value> once.
			</p>
			<p className="mt-2">
				Say they start talking at 0:00 and their {ordinal(requiredMessages)} message lands {reachedAt}s later. They earn
				there and then wait out the rest of that same {timespanSeconds}s window -- another <Value>{waitFor}s</Value> --
				before a new batch starts counting. The clock runs from their first message, not from the grant, so finishing a
				batch slowly means waiting less afterwards.
			</p>
			<p className="mt-2">
				That caps them at one grant every {timespanSeconds}s, or about{' '}
				<Value>{formatRate(perMinute)} XP a minute</Value> while talking non-stop. Anyone slower than {requiredMessages}{' '}
				messages per {timespanSeconds}s simply never completes a batch: only the last {timespanSeconds} seconds of
				messages ever count towards one.
			</p>
		</Panel>
	);
}

function Panel({ children }: { readonly children: React.ReactNode }) {
	return (
		<div className="rounded-lg border border-on-secondary bg-on-tertiary p-3 text-sm text-secondary dark:border-on-secondary-dark dark:bg-on-tertiary-dark dark:text-secondary-dark">
			{children}
		</div>
	);
}

function Value({ children }: { readonly children: React.ReactNode }) {
	return <span className="font-medium text-primary dark:text-primary-dark">{children}</span>;
}

function ordinal(value: number): string {
	// Only ever called with `required_messages`, which the API caps at 15 -- no need for the general rule.
	const suffix = value === 2 ? 'nd' : value === 3 ? 'rd' : 'th';
	return `${value}${suffix}`;
}

/**
 * Whole numbers stay whole (`20`, not `20.0`); anything else keeps one decimal, since a 45s window lands on 13.3
 * and rounding it to 13 would be a visible lie about the ceiling.
 */
function formatRate(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
