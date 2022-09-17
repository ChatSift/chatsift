import { chunkArray } from '@chatsift/utils';
import { REST } from '@discordjs/rest';
import type { SelfAssignableRole } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import type {
	APIGuildInteraction,
	RESTGetAPIGuildRolesResult,
	APISelectMenuOption,
	APIRole,
} from 'discord-api-types/v9';
import { ComponentType, InteractionResponseType, Routes } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';
import { send } from '#util';

@injectable()
export default class implements Component {
	public constructor(public readonly prisma: PrismaClient, public readonly rest: REST) {}

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

		const rolesList = await (
			this.rest.get(Routes.guildRoles(interaction.guild_id)) as Promise<RESTGetAPIGuildRolesResult>
		).then((roles) => roles.map((role): [string, APIRole] => [role.id, role]));
		const roles = new Map(rolesList);

		const selfAssignableRoles: Promise<SelfAssignableRole>[] = [];
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
					selfAssignableRoles.push(
						this.prisma.selfAssignableRole.delete({
							where: { roleId_promptId: { promptId: prompt!.promptId, roleId: roleData.roleId } },
						}),
					);
				}

				return arr;
			}, []),
			25,
		);
		await Promise.allSettled(selfAssignableRoles);

		if (!menuOptions.length) {
			return send(interaction, {
				content: 'There are no self assignable roles configured for that prompt, you should inform an admin',
				flags: 64,
			});
		}

		return send(interaction, {
			content: 'Use the drop-down below to manage your roles!',
			components: menuOptions.map((options, index) => ({
				type: ComponentType.ActionRow,
				components: [
					{
						type: ComponentType.SelectMenu,
						custom_id: `roles-manage|${prompt!.promptId}|${index}`,
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
