import { injectable } from 'inversify';

/**
 * Deals with "experiments" in the app. Those can serve as complete feature flags or just as a way to progressively
 * roll out a feature.
 */
@injectable()
export abstract class IExperimentHandler {
	public constructor() {
		if (this.constructor === IExperimentHandler) {
			throw new Error('This class cannot be instantiated.');
		}
	}

	/**
	 * Checks if a given guild is in a given experiment.
	 */
	public abstract guildIsInExperiment(guildId: string, experimentName: string): boolean;
}
