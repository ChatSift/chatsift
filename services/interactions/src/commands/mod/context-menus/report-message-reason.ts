import type { ReportMessageReasonContextMenu } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import {
	APIActionRowComponent,
	APIGuildInteraction,
	APIMessageActionRowComponent,
	APIModalSubmitInteraction,
	ComponentType,
	InteractionResponseType,
	TextInputStyle,
	ButtonStyle,
	APIMessageComponentInteraction,
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../../command';
import { ReportFailure, ReportHandler } from '@automoderator/util';
import { PrismaClient } from '@prisma/client';
import { Handler } from '#handler';
import { nanoid } from 'nanoid';

@injectable()
export default class implements Command {
	public readonly name = 'report message with reason';

	public constructor(
		public readonly prisma: PrismaClient,
		public readonly reports: ReportHandler,
		public readonly handler: Handler,
	) {}

	public async exec(interaction: APIGuildInteraction, { message }: ArgumentsOf<typeof ReportMessageReasonContextMenu>) {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: interaction.guild_id } });

		if (!settings?.reportsChannel) {
			throw new ControlFlowError('This server does not have a reports channel set up.');
		}

		if (message.author.id === interaction.member.user.id) {
			throw new ControlFlowError('You cannot report your own message.');
		}

		const reasonId = nanoid();

		const presetReportReasons = await this.prisma.presetReportReason.findMany({
			where: { guildId: message.guild_id },
		});

		const components: APIActionRowComponent<APIMessageActionRowComponent>[] = [];

		if (presetReportReasons.length) {
			components.push({
				type: ComponentType.ActionRow,
				components: [
					{
						type: ComponentType.SelectMenu,
						custom_id: reasonId,
						min_values: 1,
						max_values: 1,
						options: [
							{
								label: 'Custom response',
								value: 'other',
								emoji: {
									name: '❓',
								},
							},
							...presetReportReasons.map((preset, idx) => ({
								label: preset.reason,
								value: String(idx),
							})),
						],
					},
				],
			});
		}

		components.push({
			type: ComponentType.ActionRow,
			components: [
				{
					type: ComponentType.Button,
					custom_id: reasonId,
					label: 'Custom response',
					style: ButtonStyle.Secondary,
					emoji: {
						name: '❓',
					},
				},
			],
		});

		await send(interaction, {
			content: 'Please select a reason',
			flags: 64,
			components,
		});

		await this.handler.collectorManager
			.makeCollector<APIMessageComponentInteraction>(reasonId)
			.awaitableHookAndDestroy(async (selected, stop) => {
				try {
					if (selected.data.component_type === ComponentType.Button) {
						const modalId = nanoid();
						await send(
							selected,
							{
								title: 'Message report',
								custom_id: modalId,
								components: [
									{
										type: ComponentType.ActionRow,
										components: [
											{
												label: 'Report reason',
												type: ComponentType.TextInput,
												custom_id: 'reason',
												style: TextInputStyle.Paragraph,
												placeholder: 'This is the report reason the staff team will see',
												min_length: 5,
												max_length: 500,
											},
										],
									},
								],
							},
							InteractionResponseType.Modal,
						);

						const modal = await this.handler.collectorManager
							.makeCollector<APIModalSubmitInteraction>(modalId)
							.waitForOneAndDestroy();

						await send(interaction, { components: [] });

						const { value: reason } = modal.data.components![0]!.components[0]!;

						await send(modal, {});
						return await this.reports.reportMessage(
							{ ...message, guild_id: interaction.guild_id },
							interaction.member.user,
							settings.reportsChannel!,
							reason,
						);
					}

					stop();
					const idx = parseInt(selected.data.values[0]!, 10);
					const { reason } = presetReportReasons[idx]!;

					await this.reports.reportMessage(
						{ ...message, guild_id: interaction.guild_id },
						interaction.member.user,
						settings.reportsChannel!,
						reason,
					);

					return await send(interaction, {
						content: 'Successfully flagged the given message to the staff team',
						components: [],
						flags: 64,
					});
				} catch (error) {
					if (error instanceof ReportFailure) {
						throw new ControlFlowError(error.reason);
					}

					throw error;
				}
			});
	}
}
