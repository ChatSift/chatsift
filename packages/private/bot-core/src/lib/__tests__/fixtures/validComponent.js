/* eslint-disable @typescript-eslint/explicit-member-accessibility -- plain JS, not TS; accessibility modifiers aren't valid syntax here */

// Fixture consumed by `registerComponentHandlers`' glob loader in components.test.ts -- deliberately plain JS
// since the real loader only ever imports compiled `.js` output, never `.ts`.
export const calls = [];

export default class FixtureValidComponent {
	name = 'fixture-valid-component';

	stateStore = null;

	async handle(interaction, state, logger) {
		calls.push({ interaction, logger, state });
	}
}
