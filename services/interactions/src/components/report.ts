import { Config, kConfig } from '@automoderator/injection';
import { CaseManager } from '@automoderator/util';
import { REST } from '@discordjs/rest';
import ms from '@naval-base/ms';
import { CaseAction, PrismaClient } from '@prisma/client';
import type {
	APIGuildInteraction,
	APIButtonComponent,
	RESTPatchAPIChannelMessageJSONBody,
	APIMessageComponentInteraction,
	APIMessageSelectMenuInteractionData,
	APIModalSubmitInteraction,
	APISelectMenuComponent,
	APIUser,
} from 'discord-api-types/v9';
import { ComponentType, Routes, ButtonStyle, InteractionResponseType, TextInputStyle } from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { inject, injectable } from 'tsyringe';
import type { StopFunction } from '../collector';
import type { Component } from '../component';
import { Handler } from '#handler';
import { send } from '#util';

@injectable()
export default class implements Component {
	public constructor(
		public readonly rest: REST,
		public readonly prisma: PrismaClient,
		public readonly handler: Handler,
		public readonly cases: CaseManager,
		@inject(kConfig) public readonly config: Config,
	) {}

	public async exec(interaction: APIGuildInteraction, [reportIdRaw, action]: [string, string]) {
		const reportId = Number.parseInt(reportIdRaw, 10);
		const [review, acknowledged, viewReporters, actionButton] = interaction.message!.components![0]!.components as [
			APIButtonComponent,
			APIButtonComponent,
			APIButtonComponent,
			APIButtonComponent,
		];

		const [embed] = interaction.message!.embeds;
		const report = await this.prisma.report.findFirst({ where: { reportId }, rejectOnNotFound: true });

		switch (action) {
			case 'acknowledge': {
				const isDismiss = acknowledged.label === 'Dismiss';

				await this.prisma.report.update({
					data: {
						acknowledgedAt: isDismiss ? new Date() : null,
					},
					where: {
						reportId,
					},
				});

				acknowledged.label = isDismiss ? 'Restore' : 'Dismiss';
				acknowledged.style = isDismiss ? ButtonStyle.Danger : ButtonStyle.Success;

				if (embed) {
					embed.color = isDismiss ? 2_895_667 : 15_953_004;
				}

				return send(
					interaction,
					{
						components: [
							{
								type: ComponentType.ActionRow,
								components: [review, acknowledged, viewReporters, actionButton],
							},
						],
						embeds: embed ? [embed] : undefined,
					},
					InteractionResponseType.UpdateMessage,
				);
			}

			case 'view-reporters': {
				const { reporters } = await this.prisma.report.findFirst({
					where: { reportId },
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

				const state: { action?: CaseAction | 'noop'; duration?: number; reason?: string } = {};

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
											value: 'noop',
											label: 'No action',
										},
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
							const action = (interaction.data as APIMessageSelectMenuInteractionData).values[0] as CaseAction | 'noop';
							if (action === CaseAction.mute) {
								const existingCs = await this.prisma.case.findFirst({
									where: {
										guildId: interaction.guild_id,
										targetId: report.userId,
										actionType: CaseAction.mute,
										task: { isNot: null },
									},
								});

								if (existingCs) {
									return send(
										interaction,
										{
											content: '⚠️ This user is currently muted',
										},
										InteractionResponseType.UpdateMessage,
									);
								}
							}

							state.action = action;
							const { components } = interaction.message;
							const component = interaction.message.components![0]!.components[0]! as APISelectMenuComponent;
							const optionIdx = component.options.findIndex((option) => option.value === state.action);
							component.options = component.options.map((option, idx) => ({ ...option, default: optionIdx === idx }));

							await send(
								interaction,
								{
									content: `Executing ${
										action === 'noop' ? 'no action' : `a ${action}`
									} - feel free to configure further`,
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
							if (!state.action) {
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
													value: state.duration ? ms(state.duration) : undefined,
													placeholder: 'e.g. 1h30m',
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

							await send(modal, {}, InteractionResponseType.ChannelMessageWithSource);
							const [parsedReason, parsedDuration] = [0, 1].map(
								(num) => modal.data.components![num]!.components[0]!.value,
							);

							if (parsedDuration) {
								if (state.action !== CaseAction.ban && state.action !== CaseAction.mute) {
									return send(
										interaction,
										{
											content: '⚠️ You can only update the duration for bans and mutes',
											flags: 64,
										},
										InteractionResponseType.UpdateMessage,
									);
								}

								const parsed = ms(parsedDuration);
								if (parsed <= 0) {
									return send(interaction, {
										content: '⚠️ Failed to parse the provided duration - please try again',
										flags: 64,
									});
								}

								state.duration = parsed;
							}

							// eslint-disable-next-line require-atomic-updates
							state.reason = parsedReason!;
							return send(interaction, {
								content: `Executing a ${state.action}${
									state.duration ? `, which will last for ${ms(state.duration, true)}` : ''
								}${state.reason ? ` with reason ${state.reason}` : ''}`,
								flags: 64,
							});
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
							const user = (await this.rest.get(Routes.user(report.userId))) as APIUser;
							const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: interaction.guild_id } });

							actionButton.disabled = true;
							if (state.duration && state.action !== CaseAction.ban && state.action !== CaseAction.mute) {
								return send(interaction, { content: '⚠️ Duration is only available for bans and mutes.', flags: 64 });
							}

							if (state.action !== 'noop') {
								await this.cases.create({
									actionType: state.action,
									guildId: interaction.guild_id,
									targetId: report.userId,
									targetTag: `${user.username}#${user.discriminator}`,
									mod: {
										id: interaction.member.user.id,
										tag: `${interaction.member.user.username}#${interaction.member.user.discriminator}`,
									},
									expiresAt: state.duration ? new Date(Date.now() + state.duration) : undefined,
									unmuteRoles:
										state.action === CaseAction.mute && (settings?.useTimeoutsByDefault ?? true) ? null : undefined,
									reason: state.reason,
								});
							}

							await send(interaction, {
								content: 'Successfully actioned the report',
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

				await this.prisma.report.update({
					data: {
						acknowledgedAt: new Date(),
					},
					where: {
						reportId,
					},
				});

				if (embed) {
					embed.color = 2_895_667;
				}

				break;
			}
		}

		const body: RESTPatchAPIChannelMessageJSONBody = {
			components: [
				{
					type: ComponentType.ActionRow,
					components: [review, acknowledged, viewReporters, actionButton],
				},
			],
			embeds: embed ? [embed] : undefined,
		};

		return (
			this.rest
				.patch(Routes.channelMessage(interaction.channel_id!, interaction.message!.id), {
					body,
				})
				// eslint-disable-next-line promise/prefer-await-to-then
				.catch(() => null)
		);
	}
}
