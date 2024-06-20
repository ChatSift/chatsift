import { setInterval } from 'node:timers';
import { inject, injectable } from 'inversify';
import murmurhash from 'murmurhash';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Logger } from 'pino';
import { IDataManager, type ExperimentWithOverrides } from '../applicationData/IDataManager.js';
import { INJECTION_TOKENS } from '../container.js';
import { IExperimentHandler } from './IExperimentHandler.js';

@injectable()
export class ExperimentHandler extends IExperimentHandler {
	readonly #experimentCache = new Map<string, ExperimentWithOverrides>();

	public constructor(
		private readonly dataManager: IDataManager,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
	) {
		super();

		void this.poll();
		setInterval(async () => this.poll(), 180_000).unref();
	}

	public guildIsInExperiment(guildId: string, experimentName: string): boolean {
		const experiment = this.#experimentCache.get(experimentName);
		if (!experiment) {
			this.logger.warn(
				{ guildId, experimentName },
				'Ran experiment check for an unknown experiment. Perhaps cache is out of date?',
			);

			return false;
		}

		const isOverriden = experiment.overrides.some((experiment) => experiment.guildId === guildId);
		if (isOverriden) {
			return true;
		}

		const hash = this.computeExperimentHash(experimentName, guildId);
		return hash >= experiment.rangeStart && hash < experiment.rangeEnd;
	}

	private async poll(): Promise<void> {
		const experiments = await this.dataManager.getExperiments();

		this.#experimentCache.clear();
		for (const experiment of experiments) {
			this.#experimentCache.set(experiment.name, experiment);
		}
	}

	private computeExperimentHash(name: string, guildId: string): number {
		return murmurhash.v3(`${name}:${guildId}`) % 1e4;
	}
}
