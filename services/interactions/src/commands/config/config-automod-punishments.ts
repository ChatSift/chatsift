import type { ConfigAutomodPunishmentsCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { Rest } from '@cordis/rest';
import ms from '@naval-base/ms';
import { PrismaClient, AutomodPunishmentAction } from '@prisma/client';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';

@injectable()
export default class implements Command {
	public constructor(public readonly rest: Rest, public readonly prisma: PrismaClient) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigAutomodPunishmentsCommand>) {
		switch (Object.keys(args)[0] as 'add' | 'delete' | 'list') {
			case 'add': {
				let duration;
				if (args.add.duration) {
					if (
						args.add.punishment === AutomodPunishmentAction.kick ||
						args.add.punishment === AutomodPunishmentAction.warn
					) {
						throw new ControlFlowError('Cannot set a duration for kicks or warns');
					}

					duration = ms(args.add.duration);
					if (duration <= 0) {
						throw new ControlFlowError('Failed to parse duration');
					}
				}

				const data = await this.prisma.automodPunishment.upsert({
					create: {
						guildId: interaction.guild_id,
						actionType: args.add.punishment,
						triggers: args.add.count,
						duration,
					},
					update: {
						duration,
					},
					where: { guildId_triggers: { guildId: interaction.guild_id, triggers: args.add.count } },
				});

				return send(interaction, {
					content: `A punishment will now trigger at ${data.triggers}, causing a ${data.actionType}`,
				});
			}

			case 'delete': {
				try {
					await this.prisma.automodPunishment.delete({
						where: { guildId_triggers: { guildId: interaction.guild_id, triggers: args.delete.count } },
					});
					return await send(interaction, {
						content: `Successfully deleted the punishment triggered at ${args.delete.count} triggers`,
					});
				} catch {
					throw new ControlFlowError('Could not find a punishment to delete');
				}
			}

			case 'list': {
				const punishmentsData = await this.prisma.automodPunishment.findMany({
					where: { guildId: interaction.guild_id },
				});
				const punishments = punishmentsData.map(
					(p) =>
						`• At ${p.triggers} triggers, a ${p.actionType} will be triggered${
							p.duration ? ` which will last ${ms(Number(p.duration), true)}` : ''
						}`,
				);

				return send(interaction, {
					content: punishments.length
						? `List of punishments:\n${punishments.join('\n')}`
						: 'There are currently no punishments',
				});
			}
		}
	}
}
