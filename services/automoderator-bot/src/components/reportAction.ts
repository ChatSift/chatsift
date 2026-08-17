import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ComponentType, MessageFlags } from '@discordjs/core';
import { REPORT_ACTION_OPTIONS, REPORT_COMPONENT } from '../lib/reportCard.js';
import { resolveCardInteraction } from '../lib/reportComponents.js';

export default class ReportActionComponent implements ComponentHandler<string> {
	public readonly name = REPORT_COMPONENT.action;

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, reportId: string, logger: Logger): Promise<void> {
		const resolved = await resolveCardInteraction(interaction, reportId, logger);
		if (!resolved) {
			return;
		}

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: `What should happen to **${resolved.report.targetTag}**?`,
			flags: MessageFlags.Ephemeral,
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							type: ComponentType.StringSelect,
							custom_id: `${REPORT_COMPONENT.actionSelect}:${resolved.report.id}`,
							placeholder: 'Select an action',
							min_values: 1,
							max_values: 1,
							options: REPORT_ACTION_OPTIONS.map((option) => ({
								label: option.label,
								value: option.action,
								description: option.description,
							})),
						},
					],
				},
			],
		});
	}
}
