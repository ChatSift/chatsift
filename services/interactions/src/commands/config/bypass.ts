import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { BypassCommand } from '#interactions';
import type { ArgumentsOf } from '#util';
import { ControlFlowError, send } from '#util';

@injectable()
export default class implements Command {
	public constructor(public readonly rest: REST, public readonly prisma: PrismaClient) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof BypassCommand>) {
		switch (Object.keys(args)[0] as 'add' | 'list' | 'remove') {
			case 'add': {
				try {
					await this.prisma.bypassRole.create({
						data: {
							guildId: interaction.guild_id,
							roleId: args.add.role.id,
						},
					});

					return await send(interaction, {
						content: 'Successfully added a new bypass role.',
					});
				} catch {
					return send(interaction, { content: 'That role is already a bypass role' });
				}
			}

			case 'remove': {
				try {
					await this.prisma.bypassRole.delete({
						where: {
							roleId: args.remove.role.id,
						},
					});

					return await send(interaction, {
						content: 'Successfully removed the bypass role.',
					});
				} catch {
					return send(interaction, { content: 'That role is not a bypass role' });
				}
			}

			case 'list': {
				const roles = await this.prisma.bypassRole.findMany({ where: { guildId: interaction.guild_id } });
				return send(interaction, {
					content: roles.length
						? `Here are the current bypass roles: ${roles.map((role) => `<@&${role.roleId}>`).join(', ')}`
						: 'You have no bypass roles',
					allowed_mentions: { parse: [] },
				});
			}
		}
	}
}
