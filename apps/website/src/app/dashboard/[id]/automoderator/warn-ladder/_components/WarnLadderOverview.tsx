'use client';

import { useParams } from 'next/navigation';
import { describeStep } from './ladderDisplay';
import { useAutomoderatorConfig } from '@/api/routes/automoderator';
import type { AutomoderatorWarnPunishment, WarnPunishmentActionName } from '@/api/routes/automoderatorWarnPunishments';
import { useAutomoderatorWarnPunishments } from '@/api/routes/automoderatorWarnPunishments';

/**
 * A configured step, or a run of counts that only record the warning.
 */
type Rung =
	{ from: number; kind: 'gap'; to: number } | { kind: 'step'; step: AutomoderatorWarnPunishment; warns: number };

/**
 * The page's overview: what actually happens as one member's warnings accumulate, rather than a grid of cards
 * that each only describe themselves.
 *
 * The gaps are the point. Steps match an **exact** count, so a ladder at 3 and 5 does nothing on the fourth
 * warning — which is the thing people get wrong about this feature and which no list of independent cards shows.
 */
export function WarnLadderOverview() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: steps } = useAutomoderatorWarnPunishments(guildId);
	const { data: config } = useAutomoderatorConfig(guildId);

	if (!steps || steps.length === 0) {
		return null;
	}

	// Every count from 1 to the last configured step, so the ones that do nothing are visible as gaps rather
	// than invisible by omission -- but **runs of them collapse into one row**. A ladder at 3, 5 and 10 has
	// seven counts that only record the warning, and seven identical rows say nothing the one row doesn't.
	const highest = Number(steps.at(-1)!.warns);
	const byWarns = new Map(steps.map((step) => [Number(step.warns), step]));

	const rungs: Rung[] = [];
	for (let warns = 1; warns <= highest; warns++) {
		const step = byWarns.get(warns);

		if (step) {
			rungs.push({ kind: 'step', warns, step });
			continue;
		}

		const last = rungs.at(-1);
		if (last?.kind === 'gap') {
			last.to = warns;
		} else {
			rungs.push({ kind: 'gap', from: warns, to: warns });
		}
	}

	return (
		<div className="space-y-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark md:col-span-2 lg:col-span-3">
			<div>
				<h3 className="text-sm font-medium text-primary dark:text-primary-dark">The ladder</h3>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
					What happens as one member&apos;s active warnings add up. A step fires on the warning that brings them to{' '}
					<em>exactly</em> that count, so the greyed-out rungs below only record the warning.
					{config?.autoPardonWarnsAfter
						? ` Warnings stop counting after ${config.autoPardonWarnsAfter} ${
								config.autoPardonWarnsAfter === 1 ? 'day' : 'days'
							}, so a member can drop back down the ladder.`
						: ' Warnings never expire, so members only ever move up this ladder.'}
				</p>
			</div>

			<ol className="space-y-0">
				{rungs.map((rung, index) => {
					const isLast = index === rungs.length - 1;

					if (rung.kind === 'gap') {
						return (
							<li className="flex gap-3" key={`gap-${rung.from}`}>
								{/* A hollow dot and a dashed rail, so a stretch that does nothing reads as a pause in the
								    ladder rather than as another step. */}
								<div className="flex shrink-0 flex-col items-center">
									<span className="mt-1.5 h-2.5 w-2.5 rounded-full border border-on-secondary dark:border-on-secondary-dark" />
									{!isLast && (
										<span className="w-px flex-1 border-l border-dashed border-on-secondary dark:border-on-secondary-dark" />
									)}
								</div>

								<div className="flex-1 pb-5">
									<p className="text-sm text-secondary dark:text-secondary-dark">
										{rung.from === rung.to
											? `${rung.from} ${rung.from === 1 ? 'warning' : 'warnings'}`
											: `${rung.from}–${rung.to} warnings`}{' '}
										— recorded only
									</p>
								</div>
							</li>
						);
					}

					return (
						<li className="flex gap-3" key={`step-${rung.warns}`}>
							{/* The rail: a dot per rung, joined by a line to the next one. */}
							<div className="flex shrink-0 flex-col items-center">
								<span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-misc-accent" />
								{!isLast && <span className="w-px flex-1 bg-on-secondary dark:bg-on-secondary-dark" />}
							</div>

							<div className="flex-1 pb-5">
								<p className="text-sm font-medium text-primary dark:text-primary-dark">
									{rung.warns} {rung.warns === 1 ? 'warning' : 'warnings'}
								</p>
								<p className="mt-1 text-xs text-secondary dark:text-secondary-dark">
									{describeStep(rung.step.actionType as WarnPunishmentActionName, rung.step.durationSeconds)}
								</p>
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
