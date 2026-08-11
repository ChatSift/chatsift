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
 * How many `{{ targets }}` a single invocation can mention. Three is a judgement call, not a legacy-verified
 * number: the legacy repo isn't checked out and the port doc only records that `{{ targets }}` is plural and
 * populated from user-mention options. Widening or narrowing it later is cheap -- a resync re-registers every
 * command from this body, so the option set follows whatever this says (#343 P3 should sanity-check the
 * rendered output against the live legacy bot before cutover).
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
					// `target`, `target2`, `target3` -- the first is unnumbered so the common single-target case
					// reads as `/hug target:@someone`, and every one of them is optional so `/hug` on its own
					// stays valid (it renders with an empty `{{ targets }}`).
					name: index === 0 ? 'target' : `target${index + 1}`,
					description: index === 0 ? 'Who to direct this at' : `Additional person to direct this at (${index + 1})`,
					type: ApplicationCommandOptionType.User as const,
				}))
			: [],
	};
}
