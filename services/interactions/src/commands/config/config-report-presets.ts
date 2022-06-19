import type { ConfigReportPresetsCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { Rest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';

@injectable()
export default class implements Command {
	public constructor(public readonly rest: Rest, public readonly prisma: PrismaClient) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigReportPresetsCommand>) {
		switch (Object.keys(args)[0] as 'add' | 'delete' | 'list') {
			case 'add': {
				await this.prisma.presetReportReason.create({
					data: {
						guildId: interaction.guild_id,
						reason: args.add.reason,
					},
				});

				return send(interaction, {
					content: 'Successfully added a new preset.',
				});
			}

			case 'delete': {
				try {
					await this.prisma.presetReportReason.findFirst({
						where: { reportReasonId: args.delete.id, guildId: interaction.guild_id },
						rejectOnNotFound: true,
					});
					await this.prisma.presetReportReason.delete({ where: { reportReasonId: args.delete.id } });

					return await send(interaction, {
						content: 'Successfully deleted the given preset',
					});
				} catch {
					throw new ControlFlowError('Could not find a preset with that ID');
				}
			}

			case 'list': {
				const presets = await this.prisma.presetReportReason.findMany({ where: { guildId: interaction.guild_id } });
				return send(interaction, {
					content: presets.length
						? `Here are the current presets:\n${presets
								.map((preset) => `• Preset ID ${preset.reportReasonId}: ${preset.reason}`)
								.join('\n')}`
						: 'You have no available presets.',
				});
			}
		}
	}
}
