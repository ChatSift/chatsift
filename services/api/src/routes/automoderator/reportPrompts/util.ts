import {
	DEFAULT_EMBED_COLOR,
	REPORT_PROMPT_DEFAULT_BUTTON_LABEL,
	REPORT_PROMPT_DEFAULT_DESCRIPTION,
	REPORT_PROMPT_DEFAULT_TITLE,
	userInstallUrl,
} from '@chatsift/core';
import type { RESTPostAPIChannelMessageJSONBody } from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import type { z } from 'zod';
import type { createReportPromptWithRawContentSchema, createReportPromptWithRegularContentSchema } from '../schemas.js';

export type ReportPromptContent = z.infer<typeof createReportPromptWithRegularContentSchema>['prompt'];
export type ReportPromptRawContent = z.infer<typeof createReportPromptWithRawContentSchema>['prompt_raw'];

/**
 * The prompt's button.
 *
 * A **link** button rather than a `custom_id` one, which is what makes this whole message inert: there is no
 * interaction to route, so nothing in `services/automoderator-bot` has to know these exist. The destination is
 * Discord's own user-install page for this application -- see `userInstallUrl` for why that scope is the only
 * one involved.
 */
function buildPromptComponents(
	applicationId: string,
	buttonLabel: string = REPORT_PROMPT_DEFAULT_BUTTON_LABEL,
): RESTPostAPIChannelMessageJSONBody['components'] {
	return [
		{
			type: ComponentType.ActionRow,
			components: [
				{
					type: ComponentType.Button,
					style: ButtonStyle.Link,
					label: buttonLabel,
					url: userInstallUrl(applicationId),
				},
			],
		},
	];
}

/**
 * The message a report prompt posts, from either shape of the request body.
 *
 * The structured branch defaults *every* field, so a guild that names nothing but a channel still gets the
 * message this feature was designed around rather than an empty embed. The raw branch is handed through
 * untouched except for the button, which is appended either way -- a prompt without the install link is a
 * prompt that cannot do its job, and letting `prompt_raw` drop it would produce a message that looks fine and
 * leads nowhere.
 */
export function buildReportPromptBody(
	data: { prompt_raw: ReportPromptRawContent } | { prompt: ReportPromptContent },
	applicationId: string,
): RESTPostAPIChannelMessageJSONBody {
	if ('prompt_raw' in data) {
		return { ...data.prompt_raw, components: buildPromptComponents(applicationId) };
	}

	const { prompt } = data;

	return {
		embeds: [
			{
				color: prompt.color ?? DEFAULT_EMBED_COLOR,
				title: prompt.title ?? REPORT_PROMPT_DEFAULT_TITLE,
				description: prompt.description ?? REPORT_PROMPT_DEFAULT_DESCRIPTION,
				...(prompt.imageUrl && { image: { url: prompt.imageUrl } }),
				...(prompt.thumbnailUrl && { thumbnail: { url: prompt.thumbnailUrl } }),
			},
		],
		components: buildPromptComponents(applicationId, prompt.buttonLabel),
	};
}
