import { chunkArray } from '@chatsift/utils';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import { stripIndents } from 'common-tags';
import type {
	APIGuildInteraction,
	APIMessageSelectMenuInteractionData,
	RESTPatchAPIGuildMemberJSONBody,
	Snowflake,
} from 'discord-api-types/v9';
import { InteractionResponseType, Routes } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';
import { send } from '#util';

@injectable()
export default class implements Component {
	public constructor(public readonly prisma: PrismaClient, public readonly rest: REST) {}

	public async exec(interaction: APIGuildInteraction, [promptId, index]: [string, string]) {
		void send(interaction, {}, InteractionResponseType.DeferredMessageUpdate);

		const selfAssignables = new Set<Snowflake>(
			chunkArray(
				await this.prisma.selfAssignableRole
					.findMany({ where: { promptId: Number.parseInt(promptId, 10) } })
					.then((roles) => roles.map((role) => role.roleId)),
				25,
			)[Number.parseInt(index, 10)],
		);

		const roles = new Set(interaction.member.roles);

		const added: string[] = [];
		const removed: string[] = [];

		const selected = new Set((interaction.data as APIMessageSelectMenuInteractionData).values);

		for (const role of roles) {
			if (selfAssignables.has(role) && !selected.has(role)) {
				roles.delete(role);
				removed.push(`<@&${role}>`);
			}
		}

		for (const role of selected) {
			if (!roles.has(role)) {
				roles.add(role);
				added.push(`<@&${role}>`);
			}
		}

		const body: RESTPatchAPIGuildMemberJSONBody = {
			roles: [...roles],
		};
		await this.rest.patch(Routes.guildMember(interaction.guild_id, interaction.member.user.id), {
			body,
			reason: 'Self-assignable roles update',
		});

		interaction.message!.components![Number.parseInt(index, 10)]!.components[0]!.disabled = true;

		if (interaction.message!.components!.every((component) => component.components[0]!.disabled)) {
			interaction.message!.components = [];
		}

		return send(interaction, {
			content:
				added.length || removed.length
					? stripIndents`
          Succesfully updated your roles:
          ${added.length ? `• added: ${added.join(', ')}\n` : ''}${
							removed.length ? `• removed: ${removed.join(', ')}` : ''
					  }
        `
					: 'There was nothing to update!',
			components: interaction.message!.components!,
		});
	}
}
