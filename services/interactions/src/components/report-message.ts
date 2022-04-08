import { send } from '#util';
import { Rest as DiscordRest } from '@cordis/rest';
import { CaseAction, PrismaClient } from '@prisma/client';
import {
	APIGuildInteraction,
	APIButtonComponent,
	ComponentType,
	RESTPatchAPIChannelMessageJSONBody,
	Routes,
	ButtonStyle,
	APIMessageComponentInteraction,
	APIMessageSelectMenuInteractionData,
	InteractionResponseType,
	TextInputStyle,
	APIModalSubmitInteraction,
	APISelectMenuComponent,
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { Handler } from '#handler';
import { injectable } from 'tsyringe';
import type { Component } from '../component';
import type { StopFunction } from '../collector';
import ms from '@naval-base/ms';

@injectable()
export default class implements Component {
	public constructor(
		public readonly rest: DiscordRest,
		public readonly prisma: PrismaClient,
		public readonly handler: Handler,
	) {}

	// TODO(DD): Consider getting rid of message id
	public async exec(interaction: APIGuildInteraction, [messageId, action]: [string, string]) {
		const [review, acknowledged, viewReporters, actionButton] = interaction.message!.components![0]!.components as [
			APIButtonComponent,
			APIButtonComponent,
			APIButtonComponent,
			APIButtonComponent,
		];

		const [embed] = interaction.message!.embeds;

		switch (action) {
			case 'acknowledge': {
				const isDismiss = acknowledged.label === 'Dismiss';

				await this.prisma.report.update({
					data: {
						acknowledgedAt: isDismiss ? new Date() : null,
					},
					where: {
						messageId,
					},
				});

				acknowledged.label = isDismiss ? 'Restore' : 'Dismiss';
				acknowledged.style = isDismiss ? ButtonStyle.Danger : ButtonStyle.Success;

				if (embed) {
					embed.color = isDismiss ? 2895667 : 15953004;
				}

				await send(interaction, {}, InteractionResponseType.UpdateMessage);

				break;
			}

			case 'view-reporters': {
				const { reporters } = await this.prisma.report.findFirst({
					where: { messageId },
					include: { reporters: true },
					rejectOnNotFound: true,
				});

				await send(interaction, {
					content: reporters
						.map((reporter) => `• ${reporter.reporterTag} (${reporter.reporterId}): ${reporter.reason}`)
						.join('\n'),
					flags: 64,
				});

				break;
			}

			case 'action': {
				const actionId = nanoid();
				const configureId = nanoid();
				const doneId = nanoid();

				const state: { action?: CaseAction; reason?: string; duration?: number } = {};

				await send(interaction, {
					content: 'Please select the action you want to take, and optionally, the duration and reason',
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.SelectMenu,
									custom_id: actionId,
									min_values: 1,
									max_values: 1,
									placeholder: 'Select an action',
									options: [
										{
											value: CaseAction.warn,
											label: 'Warn',
											emoji: {
												name: '⚠',
											},
										},
										{
											value: CaseAction.kick,
											label: 'Kick',
											emoji: {
												name: '👢',
											},
										},
										{
											value: CaseAction.mute,
											label: 'Mute',
											emoji: {
												name: '🔇',
											},
										},
										{
											value: CaseAction.ban,
											label: 'Ban',
											emoji: {
												name: '🚫',
											},
										},
									],
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									custom_id: configureId,
									style: ButtonStyle.Primary,
									label: 'Configure additional options',
								},
								{
									type: ComponentType.Button,
									custom_id: `${doneId}|confirm`,
									style: ButtonStyle.Success,
									label: 'Confirm',
								},
								{
									type: ComponentType.Button,
									custom_id: `${doneId}|cancel`,
									style: ButtonStyle.Danger,
									label: 'Cancel',
								},
							],
						},
					],
					flags: 64,
				});

				const stops: StopFunction[] = [
					this.handler.collectorManager
						.makeCollector<APIMessageComponentInteraction>(actionId)
						.hookAndDestroy(async (interaction) => {
							state.action = (interaction.data as APIMessageSelectMenuInteractionData).values[0] as CaseAction;
							const { components } = interaction.message;
							const component = interaction.message.components![0]!.components[0]! as APISelectMenuComponent;
							const optionIdx = component.options.findIndex((option) => option.value === state.action);
							component.options = component.options.map((option, idx) => ({ ...option, default: optionIdx === idx }));

							await send(
								interaction,
								{
									content: `Executing a ${action} - feel free to configure further`,
									components,
									flags: 64,
								},
								InteractionResponseType.UpdateMessage,
							);
						}),
					this.handler.collectorManager
						.makeCollector<APIMessageComponentInteraction>(configureId)
						.hookAndDestroy(async (interaction) => {
							// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
							if (!action) {
								return send(
									interaction,
									{
										content: '⚠️ You can only update the reason and duration once the action type has been set',
									},
									InteractionResponseType.UpdateMessage,
								);
							}

							const modalId = nanoid();
							await send(
								interaction,
								{
									custom_id: modalId,
									title: 'Additional options',
									components: [
										{
											type: ComponentType.ActionRow,
											components: [
												{
													custom_id: 'reason',
													label: 'Reason',
													type: ComponentType.TextInput,
													style: TextInputStyle.Paragraph,
													required: false,
													value: state.reason,
												},
											],
										},
										{
											type: ComponentType.ActionRow,
											components: [
												{
													custom_id: 'duration',
													label: 'Duration (note: only applies to mutes/bans)',
													type: ComponentType.TextInput,
													style: TextInputStyle.Short,
													required: false,
													value: state.duration ? ms(state.duration, true) : undefined,
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

							const [parsedReason, parsedDuration] = [0, 1].map((i) => modal.data.components![i]!.components[0]!.value);

							if (parsedDuration) {
								if (state.action !== CaseAction.ban && state.action !== CaseAction.mute) {
									await send(
										interaction,
										{
											content: '⚠️ You can only update the duration for bans and mutes',
											flags: 64,
										},
										InteractionResponseType.UpdateMessage,
									);
									return send(modal, {}, InteractionResponseType.ChannelMessageWithSource);
								}

								try {
									state.duration = ms(parsedDuration);
								} catch {
									return send(modal, {
										content: 'Failed to parse the provided duration - please try again',
										flags: 64,
									});
								}
							}

							state.reason = parsedReason!;
							await send(interaction, {
								content: `Executing a ${action}${
									state.duration ? `, which will last for ${ms(state.duration, true)}` : ''
								}${state.reason ? ` with reason ${state.reason}` : ''}`,
								flags: 64,
							});

							await send(modal, {}, InteractionResponseType.ChannelMessageWithSource);
						}),
				];

				await this.handler.collectorManager
					.makeCollector<APIMessageComponentInteraction>(doneId)
					.awaitableHookAndDestroy(async (done, stop) => {
						await send(done, {}, InteractionResponseType.UpdateMessage);

						const [, confirmation] = done.data.custom_id.split('|') as [string, string];

						if (confirmation === 'cancel') {
							await send(interaction, {
								content: 'Action cancelled',
								components: [],
								flags: 64,
							});

							stop();
						} else if (state.action) {
							// TODO: Create case
							actionButton.disabled = true;

							if (state.duration && state.action !== CaseAction.ban && state.action !== CaseAction.mute) {
								return send(interaction, { content: '⚠️ Duration is only available for bans and mutes.', flags: 64 });
							}

							await send(interaction, {
								content: 'Successfully created case',
								components: [],
								flags: 64,
							});

							stop();
						} else {
							await send(interaction, {
								content: '⚠️ Please select an action',
								flags: 64,
							});
						}
					});

				for (const stop of stops) {
					stop();
				}

				if (embed) {
					embed.color = 2895667;
				}

				break;
			}
		}

		return this.rest.patch<unknown, RESTPatchAPIChannelMessageJSONBody>(
			Routes.channelMessage(interaction.channel_id!, interaction.message!.id),
			{
				data: {
					components: [
						{
							type: ComponentType.ActionRow,
							components: [review, acknowledged, viewReporters, actionButton],
						},
					],
					embed,
				},
			},
		);
	}
}
