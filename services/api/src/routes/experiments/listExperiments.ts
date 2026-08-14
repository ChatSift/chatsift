import { getContext } from '@chatsift/backend-core';
import type { ExperimentOverrides, Experiments } from '@chatsift/db';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';

export interface ExperimentWithOverrides {
	createdAt: Date;
	name: string;
	overrides: string[];
	rangeEnd: number;
	rangeStart: number;
	updatedAt: Date | null;
}

export type ListExperimentsResult = ExperimentWithOverrides[];

/**
 * Operator-facing, global-admin only, and deliberately without a dashboard page (see
 * docs/roadmap/11-automoderator-port.md's Feature gating section) -- an experiment is a per-guild kill switch
 * an operator reaches for without a deploy, not something a guild manager configures.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/experiments',
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: true,
	}),
	async handler(): Promise<ListExperimentsResult> {
		const db = getContext().db;

		const [experiments, overrides] = await Promise.all([
			db<Experiments[]>`SELECT * FROM experiments ORDER BY name ASC`,
			db<ExperimentOverrides[]>`SELECT guild_id, experiment_name FROM experiment_overrides`,
		]);

		const byExperiment = new Map<string, string[]>();
		for (const override of overrides) {
			const list = byExperiment.get(override.experimentName as string) ?? [];
			list.push(override.guildId);
			byExperiment.set(override.experimentName as string, list);
		}

		return experiments.map((experiment) => ({
			name: experiment.name as string,
			createdAt: experiment.createdAt,
			updatedAt: experiment.updatedAt,
			rangeStart: experiment.rangeStart,
			rangeEnd: experiment.rangeEnd,
			overrides: byExperiment.get(experiment.name as string) ?? [],
		}));
	},
});
