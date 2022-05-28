import { send } from '#util';
import { chunkArray } from '@chatsift/utils';
import { Rest as DiscordRest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import {
	APIGuildInteraction,
	ComponentType,
	InteractionResponseType,
	RESTGetAPIGuildRolesResult,
	APISelectMenuOption,
	Routes,
	APIRole,
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';

@injectable()
export default class implements Component {
	public constructor(public readonly prisma: PrismaClient, public readonly discordRest: DiscordRest) {}

	public async exec(interaction: APIGuildInteraction) {
		await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);

		const prompt = await this.prisma.selfAssignableRolePrompt.findFirst({
			where: {
				guildId: interaction.guild_id,
				messageId: interaction.message!.id,
			},
			include: {
				selfAssignableRoles: true,
			},
		});

		const userRoles = new Set(interaction.member.roles);

		const rolesList = await this.discordRest
			.get<RESTGetAPIGuildRolesResult>(Routes.guildRoles(interaction.guild_id))
			.then((roles) => roles.map((role): [string, APIRole] => [role.id, role]));
		const roles = new Map(rolesList);

		const menuOptions = chunkArray(
			prompt!.selfAssignableRoles.reduce<APISelectMenuOption[]>((arr, roleData) => {
				const role = roles.get(roleData.roleId);
				if (role) {
					arr.push({
						label: role.name,
						value: role.id,
						default: userRoles.has(roleData.roleId),
						emoji: roleData.emojiId
							? {
									id: roleData.emojiId,
									name: roleData.emojiName!,
									animated: roleData.emojiAnimated!,
							  }
							: undefined,
					});
				} else {
					void this.prisma.selfAssignableRole.delete({ where: { roleId: roleData.roleId } }).catch(() => null);
				}

				return arr;
			}, []),
			25,
		);

		if (!menuOptions.length) {
			return send(interaction, {
				content: 'There are no self assignable roles configured for that prompt, you should inform an admin',
				flags: 64,
			});
		}

		return send(interaction, {
			content: 'Use the drop-down below to manage your roles!',
			components: menuOptions.map((options, i) => ({
				type: ComponentType.ActionRow,
				components: [
					{
						type: ComponentType.SelectMenu,
						custom_id: `roles-manage|${prompt!.promptId}|${i}`,
						min_values: 0,
						max_values: options.length,
						options,
					},
				],
			})),
			flags: 64,
		});
	}
}
