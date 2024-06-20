/**
 * Deals with "experiments" in the app. Those can serve as complete feature flags or just as a way to progressively
 * roll out a feature.
 */
export abstract class IExperimentHandler {
	/**
	 * Checks if a given guild is in a given experiment.
	 */
	public abstract guildIsInExperiment(guildId: string, experimentName: string): boolean;
}
