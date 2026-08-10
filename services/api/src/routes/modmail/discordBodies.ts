import type { RESTPostAPIApplicationGuildCommandsJSONBody, RESTPostAPIChannelMessageJSONBody } from '@discordjs/core';
import { ApplicationCommandOptionType, ButtonStyle, ComponentType } from '@discordjs/core';

/**
 * The two Discord payloads below are each built in more than one place -- a snippet's guild command is minted
 * by `snippets/createSnippet.ts` and re-minted by `snippets/resyncSnippets.ts`; a panel's button row is posted
 * by `panels/createPanel.ts`, re-posted by `panels/resyncPanels.ts` and edited by `panels/updatePanel.ts`.
 * They have to stay byte-identical across all of those (a resync that reissued a command with a different
 * option set, or reposted a panel with a different `custom_id`, would quietly break the thing it was meant to
 * repair), so they live here rather than being copied per route.
 */

export const DEFAULT_PANEL_BUTTON_LABEL = 'Create Ticket';

/**
 * Each snippet is registered as its own guild slash command (a snippet named `reportuser` is invoked as
 * `/reportuser`) rather than as a subcommand of some shared `/snippet` command.
 */
export function buildSnippetCommandBody(name: string): RESTPostAPIApplicationGuildCommandsJSONBody {
	return {
		name,
		description: 'ModMail snippet',
		default_member_permissions: '0',
		options: [
			{
				name: 'anon',
				description: 'Whether to send the reply anonymously - defaults to false',
				type: ApplicationCommandOptionType.Boolean,
			},
		],
	};
}

/**
 * `custom_id` is what `services/modmail-bot/src/components/createTicket.ts` keys off, so it's the one part of
 * this that genuinely cannot drift. The label is the only per-panel bit, and it's stored nowhere but on the
 * live message (see `createPanel.ts` -- `panel_json_data` holds the message body, not the components).
 */
export function buildPanelComponents(
	buttonLabel: string = DEFAULT_PANEL_BUTTON_LABEL,
): RESTPostAPIChannelMessageJSONBody['components'] {
	return [
		{
			type: ComponentType.ActionRow,
			components: [
				{
					type: ComponentType.Button,
					style: ButtonStyle.Primary,
					label: buttonLabel,
					custom_id: 'modmail-create-ticket',
				},
			],
		},
	];
}
