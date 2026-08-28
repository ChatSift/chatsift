'use client';

import { useParams } from 'next/navigation';
import { describeStep } from './triggerLadderDisplay';
import { useAutomoderatorConfig } from '@/api/routes/automoderator';
import type {
	AutomoderatorTriggerPunishment,
	TriggerPunishmentActionName,
} from '@/api/routes/automoderatorTriggerPunishments';
import { useAutomoderatorTriggerPunishments } from '@/api/routes/automoderatorTriggerPunishments';
import { describeDuration } from '@/utils/duration';

/**
 * A configured step, or a run of counts that only delete the message.
 */
type Rung =
	{ from: number; kind: 'gap'; to: number } | { kind: 'step'; step: AutomoderatorTriggerPunishment; triggers: number };

/**
 * What actually happens as one member's filter triggers accumulate. Same shape, and the same reasoning, as the
 * warn ladder's overview: steps match an **exact** count, so a ladder at 3 and 5 does nothing on the fourth
 * hit, and a grid of independent cards is exactly the presentation that hides it.
 */
export function TriggerLadderOverview() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: steps } = useAutomoderatorTriggerPunishments(guildId);
	const { data: config } = useAutomoderatorConfig(guildId);

	if (!steps || steps.length === 0) {
		return null;
	}

	const highest = Number(steps.at(-1)!.triggers);
	const byTriggers = new Map(steps.map((step) => [Number(step.triggers), step]));

	const rungs: Rung[] = [];
	for (let triggers = 1; triggers <= highest; triggers++) {
		const step = byTriggers.get(triggers);

		if (step) {
			rungs.push({ kind: 'step', triggers, step });
			continue;
		}

		const last = rungs.at(-1);
		if (last?.kind === 'gap') {
			last.to = triggers;
		} else {
			rungs.push({ kind: 'gap', from: triggers, to: triggers });
		}
	}

	return (
		<div className="space-y-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark md:col-span-2 lg:col-span-3">
			<div>
				<h3 className="text-sm font-medium text-primary dark:text-primary-dark">The ladder</h3>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
					What happens as one member&apos;s filter triggers add up. Every hit deletes the message and DMs them why; a
					step fires on the hit that brings them to <em>exactly</em> that count, so the greyed-out rungs below do
					nothing beyond that.
					{config?.triggerDecayMinutes
						? ` One trigger falls off their count every ${describeDuration(config.triggerDecayMinutes * 60)}, so a member can drop back down the ladder.`
						: ' Triggers never expire, so members only ever move up this ladder.'}
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
											? `${rung.from} ${rung.from === 1 ? 'trigger' : 'triggers'}`
											: `${rung.from}–${rung.to} triggers`}{' '}
										— message deleted only
									</p>
								</div>
							</li>
						);
					}

					return (
						<li className="flex gap-3" key={`step-${rung.triggers}`}>
							{/* The rail: a dot per rung, joined by a line to the next one. */}
							<div className="flex shrink-0 flex-col items-center">
								<span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-misc-accent" />
								{!isLast && <span className="w-px flex-1 bg-on-secondary dark:bg-on-secondary-dark" />}
							</div>

							<div className="flex-1 pb-5">
								<p className="text-sm font-medium text-primary dark:text-primary-dark">
									{rung.triggers} {rung.triggers === 1 ? 'trigger' : 'triggers'}
								</p>
								<p className="mt-1 text-xs text-secondary dark:text-secondary-dark">
									{describeStep(rung.step.actionType as TriggerPunishmentActionName, rung.step.durationSeconds)}
								</p>
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
