import { send } from '#util';
import type { ApiGetGuildPromptResult } from '@automoderator/core';
import { Rest } from '@chatsift/api-wrapper';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, InteractionResponseType, Routes, Snowflake } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';

@injectable()
export default class implements Component {
	public constructor(public readonly rest: Rest, public readonly discordRest: DiscordRest) {}

	public async exec(interaction: APIGuildInteraction, [roleId]: [string]) {
		void send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);

		const selfAssignables = new Set<Snowflake>(
			await this.rest
				.get<ApiGetGuildPromptResult>(`/guilds/${interaction.guild_id}/prompts/messages/${interaction.message!.id}`)
				.then((prompt) => prompt.roles.map((role) => role.role_id)),
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
