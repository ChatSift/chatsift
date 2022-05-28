import { send } from '#util';
import { Rest as DiscordRest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import { APIGuildInteraction, InteractionResponseType, Routes, Snowflake } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';

@injectable()
export default class implements Component {
	public constructor(public readonly prisma: PrismaClient, public readonly discordRest: DiscordRest) {}

	public async exec(interaction: APIGuildInteraction, [roleId]: [string]) {
		void send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);

		const selfAssignables = new Set<Snowflake>(
			await this.prisma.selfAssignableRolePrompt
				.findFirst({
					where: { guildId: interaction.guild_id, messageId: interaction.message!.id },
					include: { selfAssignableRoles: true },
				})
				.then((prompt) => prompt!.selfAssignableRoles.map((role) => role.roleId)),
		);

		if (!selfAssignables.has(roleId)) {
			return send(interaction, {
				content: 'It seems that role is no longer self assignable. Please ask an admin to update this prompt.',
			});
		}

		const roles = new Set(interaction.member.roles);
		const add = !roles.has(roleId);

		if (add) {
			await this.discordRest.put(Routes.guildMemberRole(interaction.guild_id, interaction.member.user.id, roleId), {
				reason: 'Self-assignable roles update',
			});
		} else {
			await this.discordRest.delete(Routes.guildMemberRole(interaction.guild_id, interaction.member.user.id, roleId), {
				reason: 'Self-assignable roles update',
			});
		}

		return send(interaction, {
			content: `Successfully ${add ? 'added' : 'removed'} the given role ${add ? 'to' : 'from'} you`,
		});
	}
}
