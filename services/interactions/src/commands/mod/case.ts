import type { Log } from '@automoderator/broker-types';
import { LogTypes } from '@automoderator/broker-types';
import { makeCaseEmbed } from '@automoderator/util';
import { PubSubPublisher } from '@cordis/brokers';
import { REST } from '@discordjs/rest';
import ms from '@naval-base/ms';
import type { Case } from '@prisma/client';
import { CaseAction, LogChannelType, PrismaClient } from '@prisma/client';
import type { APIGuildInteraction, APIMessageComponentInteraction, APIUser } from 'discord-api-types/v9';
import { ButtonStyle, ComponentType, Routes } from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler, CollectorTimeoutError } from '../../handler';
import type { CaseCommand } from '#interactions';
import type { ArgumentsOf } from '#util';
import { ControlFlowError, send } from '#util';

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: REST,
		public readonly prisma: PrismaClient,
		public readonly handler: Handler,
		public readonly guildLogs: PubSubPublisher<Log>,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof CaseCommand>) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'show':
			case 'delete': {
				const isShow = Object.keys(args)[0] === 'show';
				const caseId = isShow ? args.show.case : args.delete.case;

				const cs = await this.prisma.case.findFirst({ where: { guildId: interaction.guild_id, caseId } });

				if (!cs) {
					throw new ControlFlowError('Case could not be found');
				}

				const [target, mod] = await Promise.all([
					this.rest.get(Routes.user(cs.targetId)) as Promise<APIUser>,
					(cs.modId ? this.rest.get(Routes.user(cs.modId)) : Promise.resolve(null)) as Promise<APIUser | null>,
				]);

				let refCs: Case | null = null;
				if (cs.refId) {
					refCs = await this.prisma.case.findFirst({ where: { guildId: interaction.guild_id, caseId: cs.refId } });
				}

				const logWebhook = await this.prisma.logChannelWebhook.findFirst({
					where: { guildId: interaction.guild_id, logType: LogChannelType.mod },
				});

				let pardonedBy: APIUser | undefined;
				if (cs.pardonedBy) {
					pardonedBy = cs.pardonedBy === mod?.id ? mod : ((await this.rest.get(Routes.user(cs.targetId))) as APIUser);
				}

				const embed = makeCaseEmbed({
					logChannelId: logWebhook?.threadId ?? logWebhook?.channelId,
					cs,
					target,
					mod,
					refCs,
					pardonedBy,
				});

				if (isShow) {
					return send(interaction, { embed });
				}

				const confirmId = nanoid();
				await send(interaction, {
					content: 'Are you sure you want to delete this case?',
					embed,
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									label: 'Confirm',
									style: ButtonStyle.Success,
									custom_id: `${confirmId}|confirm`,
								},
								{
									type: ComponentType.Button,
									label: 'Cancel',
									style: ButtonStyle.Danger,
									custom_id: `${confirmId}|cancel`,
								},
							],
						},
					],
					flags: 64,
				});

				try {
					const confirmation = await this.handler.collectorManager
						.makeCollector<APIMessageComponentInteraction>(confirmId)
						.waitForOneAndDestroy(30_000);

					const [, action] = confirmation.data.custom_id.split('|') as [string, string];
					if (action === 'cancel') {
						return await send(interaction, {
							content: 'Case deletion cancelled',
						});
					}

					await this.prisma.case.delete({ where: { id: cs.id } });
					return await send(interaction, { content: 'Successfully deleted case', embeds: [] });
				} catch (error) {
					if (error instanceof CollectorTimeoutError) {
						return send(interaction, { content: 'Timed out.' });
					}

					throw error;
				}
			}

			case 'pardon': {
				const cs = await this.prisma.case.findFirst({
					where: { guildId: interaction.guild_id, caseId: args.pardon.case },
				});

				if (!cs) {
					throw new ControlFlowError('Case could not be found');
				}

				if (cs.actionType !== CaseAction.warn) {
					throw new ControlFlowError('Case is not a warning');
				}

				const updated = await this.prisma.case.update({
					data: {
						pardonedBy: interaction.member.user.id,
					},
					where: { id: cs.id },
				});

				await send(interaction, { content: 'Successfully pardoned warning' });

				this.guildLogs.publish({
					type: LogTypes.modAction,
					data: [updated],
				});

				break;
			}

			case 'reason': {
				const cs = await this.prisma.case.findFirst({
					where: { guildId: interaction.guild_id, caseId: args.reason.case },
				});

				if (!cs) {
					throw new ControlFlowError('Case could not be found');
				}

				const updated = await this.prisma.case.update({
					data: {
						reason: args.reason.reason,
						modId: cs.modId ? cs.modId : interaction.member.user.id,
						modTag: cs.modTag
							? cs.modTag
							: `${interaction.member.user.username}${interaction.member.user.discriminator}`,
					},
					where: {
						id: cs.id,
					},
				});

				await send(interaction, { content: 'Successfully updated the reason' });

				this.guildLogs.publish({
					type: LogTypes.modAction,
					data: [updated],
				});

				break;
			}

			case 'duration': {
				const duration = ms(args.duration.duration);
				if (!duration) {
					throw new ControlFlowError('Failed to parse the provided duration');
				}

				const expiresAt = new Date(Date.now() + duration);

				const cs = await this.prisma.case.findFirst({
					where: { guildId: interaction.guild_id, caseId: args.duration.case },
				});

				if (!cs) {
					throw new ControlFlowError('Case could not be found');
				}

				if (cs.actionType !== CaseAction.ban && cs.actionType !== CaseAction.mute) {
					throw new ControlFlowError('Duration can only be updated for bans and mutes');
				}

				const updated = await this.prisma.case.update({
					data: {
						expiresAt,
						modId: cs.modId ? cs.modId : interaction.member.user.id,
						modTag: cs.modTag
							? cs.modTag
							: `${interaction.member.user.username}${interaction.member.user.discriminator}`,
						task: {
							update: {
								task: {
									update: {
										runAt: expiresAt,
									},
								},
							},
						},
					},
					where: {
						id: cs.id,
					},
				});

				await send(interaction, { content: 'Successfully updated the duration' });

				this.guildLogs.publish({
					type: LogTypes.modAction,
					data: [updated],
				});

				break;
			}

			case 'reference': {
				const cs = await this.prisma.case.findFirst({
					where: { guildId: interaction.guild_id, caseId: args.reference.case },
				});

				if (!cs) {
					throw new ControlFlowError('Case could not be found');
				}

				const updated = await this.prisma.case.update({
					data: {
						refId: args.reference.reference,
						modId: cs.modId ? cs.modId : interaction.member.user.id,
						modTag: cs.modTag
							? cs.modTag
							: `${interaction.member.user.username}${interaction.member.user.discriminator}`,
					},
					where: {
						id: cs.id,
					},
				});

				await send(interaction, { content: 'Successfully updated the reference' });

				this.guildLogs.publish({
					type: LogTypes.modAction,
					data: [updated],
				});

				break;
			}
		}
	}
}
