import type { RESTPostAPIApplicationGuildCommandsJSONBody } from '@discordjs/core';
import { ApplicationCommandOptionType } from '@discordjs/core';

/**
 * A social interaction's guild command is minted by `interactions/createInteraction.ts`, renamed by
 * `updateInteraction.ts` and re-minted by `resyncInteractions.ts`. Those have to stay byte-identical (a
 * resync that reissued a command with a different option set would quietly break the thing it was meant to
 * repair), so the payload lives here rather than being copied per route -- same reasoning as
 * `routes/modmail/discordBodies.ts`.
 */

/**
 * How many `{{ targets }}` a single invocation can mention.
 *
 * Legacy registered five (`target1` required, `target2`-`target5` optional) -- checked against its source during
 * #343 P3, which is what the previous note here asked for. Three, all optional, is a deliberate narrowing: the
 * fourth and fifth were realistically never used, and dropping legacy's *required* first option is the more
 * useful half of the change, since it makes a bare `/hug` valid. Widening later is cheap -- a resync re-registers
 * every command from this body, so the option set follows whatever this says.
 */
const MAX_TARGETS = 3;

/**
 * Each interaction is registered as its own guild slash command (an interaction named `hug` is invoked as
 * `/hug`) rather than as a subcommand of some shared `/interaction` command -- that *is* the feature.
 *
 * Deliberately no `default_member_permissions`, unlike a modmail snippet's mods-only command: these are for
 * everyone in the guild to use.
 */
export function buildInteractionCommandBody(
	name: string,
	allowTargets: boolean,
): RESTPostAPIApplicationGuildCommandsJSONBody {
	return {
		name,
		description: 'Custom server interaction',
		options: allowTargets
			? Array.from({ length: MAX_TARGETS }, (_, index) => ({
					// `user`, `user2`, `user3` -- the first is unnumbered so the common single-target case reads as
					// `/hug user:@someone`, and every one of them is optional so `/hug` on its own stays valid (it
					// renders with an empty `{{ targets }}`).
					//
					// The bot's dispatch renderer reads these names to build `{{ targets }}`
					// (services/social-bot/src/lib/interactions.ts), so they're a contract between the two
					// services, not just labels.
					name: index === 0 ? 'user' : `user${index + 1}`,
					description: index === 0 ? 'Who to direct this at' : `Additional person to direct this at (${index + 1})`,
					type: ApplicationCommandOptionType.User as const,
				}))
			: [],
	};
}
