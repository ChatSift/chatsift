import { calculateTotalRequiredXp } from '@chatsift/core';

/**
 * How many levels to lay out. Enough to make the curve's shape obvious (it's quadratic -- the gap between rows
 * grows by `multiplier` every time) without turning the config page into a table nobody reads.
 */
const PREVIEW_LEVELS = 10;

interface XpCurvePreviewProps {
	readonly base: number;
	readonly multiplier: number;
	/**
	 * XP granted per eligible window, used for the "roughly this many grants" column. Omitted while the value in
	 * the form isn't usable yet, in which case that column is dropped rather than showing `Infinity`.
	 */
	readonly xpGain?: number | undefined;
}

/**
 * A curve mistake is the config error on this page that hurts most -- it's invisible until members are already
 * levelling on the wrong ladder, and re-levels everyone the moment it's corrected. So the numbers the settings
 * above actually produce get shown directly, computed with `@chatsift/core`'s shared `calculateTotalRequiredXp`
 * (the same function the bot levels people with, deliberately not a second copy of the formula).
 */
export function XpCurvePreview({ base, multiplier, xpGain }: XpCurvePreviewProps) {
	const rows = Array.from({ length: PREVIEW_LEVELS }, (_, index) => {
		const level = index + 1;
		const total = calculateTotalRequiredXp(base, multiplier, level);

		return {
			level,
			total,
			fromPrevious: total - calculateTotalRequiredXp(base, multiplier, level - 1),
			grants: xpGain ? Math.ceil(total / xpGain) : null,
		};
	});

	return (
		<div className="max-w-xl overflow-x-auto rounded-lg border border-on-secondary dark:border-on-secondary-dark">
			{/* Every column but the row label holds a number, so they're right-aligned and tabular -- the point of
			    the table is comparing magnitudes down a column, and left-aligned proportional digits make 1,150 and
			    850 look the same size. The `w-full` on the Level header is what keeps them together: it hands that
			    column all the slack, so the figures stay in a tight block on the right instead of drifting apart as
			    the form gets wider. */}
			<table className="w-full text-sm">
				<thead className="bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark">
					<tr>
						<th className="w-full px-3 py-2 text-left font-medium">Level</th>
						<th className="whitespace-nowrap px-3 py-2 text-right font-medium">Total XP</th>
						<th className="whitespace-nowrap px-3 py-2 text-right font-medium">From previous</th>
						{xpGain ? <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Grants needed</th> : null}
					</tr>
				</thead>
				<tbody className="text-primary dark:text-primary-dark">
					{rows.map((row) => (
						<tr className="border-t border-on-secondary dark:border-on-secondary-dark" key={row.level}>
							<th className="px-3 py-1.5 text-left font-normal tabular-nums" scope="row">
								{row.level}
							</th>
							<td className="px-3 py-1.5 text-right tabular-nums">{row.total.toLocaleString()}</td>
							<td className="px-3 py-1.5 text-right tabular-nums text-secondary dark:text-secondary-dark">
								+{row.fromPrevious.toLocaleString()}
							</td>
							{row.grants === null ? null : (
								<td className="px-3 py-1.5 text-right tabular-nums text-secondary dark:text-secondary-dark">
									{row.grants.toLocaleString()}
								</td>
							)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
