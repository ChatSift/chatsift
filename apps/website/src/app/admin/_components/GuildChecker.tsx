'use client';

import type { ExperimentDecision } from '@chatsift/core';
import { resolveExperiment } from '@chatsift/core';
import { SnowflakeInput } from '@chatsift/web-core/components/SnowflakeInput';
import { useMemo, useState } from 'react';
import type { ExperimentList } from '@/api/routes/experiments';

interface GuildCheckerProps {
	readonly experiments: ExperimentList;
}

function decisionLabel(decision: ExperimentDecision): string {
	switch (decision.reason) {
		case 'override':
			return 'listed as an override';
		case 'unknown':
			return 'no range configured';
		case 'range':
			return `bucket ${decision.bucket.toLocaleString()} ${decision.enabled ? 'in' : 'not in'} [${decision.range.rangeStart.toLocaleString()}, ${decision.range.rangeEnd.toLocaleString()})`;
	}
}

/**
 * What the bots would decide for one guild, right now.
 *
 * Runs `@chatsift/core`'s `resolveExperiment` -- the same function `isExperimentEnabled` decides with -- over
 * the list already on screen, so there is no route behind this and nothing to keep in step. What it cannot
 * account for is refresh lag: a bot re-reads the tables every 60 seconds, so an experiment edited a moment ago
 * is live here before it is live there.
 */
export function GuildChecker({ experiments }: GuildCheckerProps) {
	const [guildId, setGuildId] = useState('');

	const trimmed = guildId.trim();
	const isValid = /^\d{17,20}$/.test(trimmed);

	const decisions = useMemo(() => {
		if (!isValid) {
			return [];
		}

		return experiments.map((experiment) => ({
			name: experiment.name,
			decision: resolveExperiment(
				experiment.name,
				trimmed,
				{ rangeStart: experiment.rangeStart, rangeEnd: experiment.rangeEnd },
				experiment.overrides.includes(trimmed),
			),
		}));
	}, [experiments, trimmed, isValid]);

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex flex-col gap-1">
				<p className="text-lg font-medium text-primary dark:text-primary-dark">Check a guild</p>
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Which of the experiments above are on for one server, and why. Bots pick up a change within 60 seconds, so a
					range you just edited applies here first.
				</p>
			</div>

			<SnowflakeInput
				error={trimmed && !isValid ? 'That is not a Discord ID' : undefined}
				id="experiment-check-guild"
				label="Guild ID"
				onChange={setGuildId}
				value={guildId}
			/>

			{isValid &&
				(experiments.length === 0 ? (
					<p className="text-sm text-secondary dark:text-secondary-dark">No experiments to check against yet.</p>
				) : (
					<ul className="flex flex-col gap-1">
						{decisions.map(({ name, decision }) => (
							<li
								className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-on-tertiary px-3 py-2 dark:bg-on-tertiary-dark"
								key={name}
							>
								<span className="font-mono text-sm text-primary dark:text-primary-dark">{name}</span>
								<span className="flex items-center gap-2 text-sm">
									<span
										className={
											decision.enabled ? 'font-medium text-misc-accent' : 'text-secondary dark:text-secondary-dark'
										}
									>
										{decision.enabled ? 'ON' : 'OFF'}
									</span>
									<span className="text-secondary dark:text-secondary-dark">{decisionLabel(decision)}</span>
								</span>
							</li>
						))}
					</ul>
				))}
		</div>
	);
}
