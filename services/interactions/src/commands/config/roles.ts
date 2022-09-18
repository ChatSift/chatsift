import { kLogger } from '@automoderator/injection';
import { ellipsis, MESSAGE_LIMITS } from '@chatsift/discord-utils';
import { chunkArray } from '@chatsift/utils';
import { REST } from '@discordjs/rest';
import type { SelfAssignableRole } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import type {
	APIActionRowComponent,
	APIGuildInteraction,
	APIButtonComponent,
	APIMessage,
	APIRole,
	RESTPostAPIChannelMessageJSONBody,
	RESTPatchAPIChannelMessageJSONBody,
	APIMessageActionRowComponent,
} from 'discord-api-types/v9';
import { ButtonStyle, ComponentType, Routes } from 'discord-api-types/v9';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { RolesCommand } from '#interactions';
import type { ArgumentsOf } from '#util';
import { ControlFlowError, send } from '#util';

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: REST,
		@inject(kLogger) public readonly logger: Logger,
		public readonly prisma: PrismaClient,
	) {}

	private async handlePrompt(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RolesCommand>['prompt']) {
		switch (Object.keys(args)[0] as 'create' | 'delete' | 're-display') {
			case 're-display': {
				const prompt = await this.prisma.selfAssignableRolePrompt.findFirst({
					where: { guildId: interaction.guild_id, promptId: args['re-display'].id },
					include: { selfAssignableRoles: true },
				});

				if (!prompt) {
					throw new ControlFlowError('Could not find prompt');
				}

				const rolesList = await (this.rest.get(Routes.guildRoles(interaction.guild_id)) as Promise<APIRole[]>).then(
					(roles) => roles.map((role): [string, APIRole] => [role.id, role]),
				);

				const roles = new Map(rolesList);

				let cleanedUp = 0;
				const deletedSelfAssignableRoles: Promise<SelfAssignableRole>[] = [];
				prompt.selfAssignableRoles = prompt.selfAssignableRoles.filter((role) => {
					if (!roles.has(role.roleId)) {
						deletedSelfAssignableRoles.push(
							this.prisma.selfAssignableRole.delete({
								where: { roleId_promptId: { promptId: prompt.promptId, roleId: role.roleId } },
							}),
						);
						cleanedUp++;
						return false;
					}

					return true;
				});
				await Promise.allSettled(deletedSelfAssignableRoles);

				const body: RESTPostAPIChannelMessageJSONBody = {
					embeds: [
						{
							title: prompt.embedTitle ?? undefined,
							color: prompt.embedColor,
							description: prompt.embedDescription ?? undefined,
							image: prompt.embedImage
								? {
										url: prompt.embedImage,
								  }
								: undefined,
						},
					],
					components:
						prompt.useButtons && prompt.selfAssignableRoles.length <= 25
							? chunkArray(
									prompt.selfAssignableRoles.map(
										(role): APIButtonComponent => ({
											type: ComponentType.Button,
											label: roles.get(role.roleId)!.name,
											style: ButtonStyle.Secondary,
											custom_id: `roles-manage-simple|${role.roleId}`,
											emoji: role.emojiId
												? {
														id: role.emojiId,
														name: role.emojiName!,
														animated: role.emojiAnimated!,
												  }
												: undefined,
										}),
									),
									5,
							  ).map((components) => ({ type: ComponentType.ActionRow, components }))
							: [
									{
										type: ComponentType.ActionRow,
										components: [
											{
												type: ComponentType.Button,
												label: 'Manage your roles',
												style: ButtonStyle.Primary,
												custom_id: 'roles-manage-prompt',
											},
										],
									},
							  ],
				};
				const promptMessage = (await this.rest.post(
					Routes.channelMessages(args['re-display'].channel?.id ?? interaction.channel_id!),
					{
						body,
					},
				)) as APIMessage;

				await this.prisma.selfAssignableRolePrompt.update({
					data: {
						channelId: promptMessage.channel_id,
						messageId: promptMessage.id,
					},
					where: {
						promptId: args['re-display'].id,
					},
				});

				return send(interaction, {
					content: `Successfully re-posted the prompt${cleanedUp ? ` and cleaned up ${cleanedUp} deleted roles` : ''}`,
					flags: 64,
				});
			}

			case 'delete': {
				try {
					const prompt = await this.prisma.selfAssignableRolePrompt.findFirst({ where: { promptId: args.delete.id } });
					if (prompt?.guildId !== interaction.guild_id) {
						throw new Error('Prompt guild id does not match interaction guild id');
					}

					await this.prisma.selfAssignableRolePrompt.delete({ where: { promptId: args.delete.id } });
					return await send(interaction, { content: 'Successfully deleted your prompt' });
				} catch {
					throw new ControlFlowError('Could not find prompt to delete');
				}
			}

			case 'create': {
				if (!Object.keys(args.create).length) {
					throw new ControlFlowError('Please provide at least one of the options');
				}

				const channelId = args.create.channel?.id ?? interaction.channel_id!;
				const color = args.create.color ? Number.parseInt(args.create.color.replace('#', ''), 16) : 5_793_266;

				const components: APIActionRowComponent<APIMessageActionRowComponent>[] =
					args.create.usebuttons ?? false
						? []
						: [
								{
									type: ComponentType.ActionRow,
									components: [
										{
											type: ComponentType.Button,
											label: 'Manage your roles',
											style: ButtonStyle.Primary,
											custom_id: 'roles-manage-prompt',
										},
									],
								},
						  ];

				const body: RESTPostAPIChannelMessageJSONBody = {
					embeds: [
						{
							title: args.create.title,
							color,
							description: args.create.description,
							image: args.create.imageurl
								? {
										url: args.create.imageurl,
								  }
								: undefined,
						},
					],
					components,
				};
				const promptMessage = (await this.rest.post(Routes.channelMessages(channelId), {
					body,
				})) as APIMessage;

				const prompt = await this.prisma.selfAssignableRolePrompt.create({
					data: {
						guildId: interaction.guild_id,
						channelId,
						messageId: promptMessage.id,
						embedColor: color,
						embedTitle: args.create.title,
						embedDescription: args.create.description,
						embedImage: args.create.imageurl,
						useButtons: args.create.usebuttons ?? false,
					},
				});

				return send(interaction, {
					content: `Successfully created your prompt with an id of ${prompt.promptId}`,
					flags: 64,
				});
			}
		}
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RolesCommand>) {
		switch (Object.keys(args)[0] as 'add' | 'list' | 'prompt' | 'remove') {
			case 'prompt': {
				return this.handlePrompt(interaction, args.prompt);
			}

			case 'add': {
				try {
					let emoji;
					if (args.add.emoji) {
						// eslint-disable-next-line unicorn/no-unsafe-regex
						const match = /^(?:<(?<animated>a)?:(?<name>\w{2,32}):)?(?<id>\d{17,21})>?$/.exec(args.add.emoji);
						if (!match) {
							throw new ControlFlowError('Invalid emoji.');
						}

						emoji = {
							id: match.groups!.id!,
							name: match.groups!.name!,
							animated: match.groups!.animated === 'a',
						};
					}

					let prompt = await this.prisma.selfAssignableRolePrompt.findFirst({
						where: { guildId: interaction.guild_id, promptId: args.add.prompt },
						include: { selfAssignableRoles: true },
					});

					if (!prompt) {
						throw new Error('prompt not found');
					}

					const data = {
						guildId: interaction.guild_id,
						promptId: args.add.prompt,
						roleId: args.add.role.id,
						emojiId: emoji?.id,
						emojiName: emoji?.name,
						emojiAnimated: emoji?.animated,
					};
					await this.prisma.selfAssignableRole.upsert({
						create: data,
						update: data,
						where: { roleId_promptId: { promptId: prompt.promptId, roleId: data.roleId } },
					});

					prompt = (await this.prisma.selfAssignableRolePrompt.findFirst({
						where: { guildId: interaction.guild_id, promptId: args.add.prompt },
						include: { selfAssignableRoles: true },
					}))!;

					const rolesList = await (this.rest.get(Routes.guildRoles(interaction.guild_id)) as Promise<APIRole[]>).then(
						(roles) => roles.map((role): [string, APIRole] => [role.id, role]),
					);
					const roles = new Map(rolesList);

					let cleanedUp = 0;
					prompt.selfAssignableRoles = prompt.selfAssignableRoles.filter((role) => {
						if (!roles.has(role.roleId)) {
							cleanedUp++;
							return false;
						}

						return true;
					});

					const body: RESTPatchAPIChannelMessageJSONBody = {
						components:
							prompt.useButtons && prompt.selfAssignableRoles.length <= 25
								? chunkArray(
										prompt.selfAssignableRoles.map(
											(role): APIButtonComponent => ({
												type: ComponentType.Button,
												label: roles.get(role.roleId)!.name,
												style: ButtonStyle.Secondary,
												custom_id: `roles-manage-simple|${role.roleId}`,
												emoji: role.emojiId
													? {
															id: role.emojiId,
															name: role.emojiName!,
															animated: role.emojiAnimated!,
													  }
													: undefined,
											}),
										),
										5,
								  ).map((components) => ({ type: ComponentType.ActionRow, components }))
								: [
										{
											type: ComponentType.ActionRow,
											components: [
												{
													type: ComponentType.Button,
													label: 'Manage your roles',
													style: ButtonStyle.Primary,
													custom_id: 'roles-manage-prompt',
												},
											],
										},
								  ],
					};
					await this.rest
						.patch(Routes.channelMessage(prompt.channelId, prompt.messageId), {
							body,
						})
						.catch(() => null);

					let content = 'Successfully added the given role to the list of self assignable roles';

					if (cleanedUp) {
						content += ` and cleaned up ${cleanedUp} deleted roles`;
					}

					if (prompt.selfAssignableRoles.length > 25 && prompt.useButtons) {
						content += "\n\nWARNING: You've gone above 25 buttons, switching to dropdown";
					}

					return await send(interaction, { content });
				} catch {
					throw new ControlFlowError('Could not find the given prompt/the given role was already added to it');
				}
			}

			case 'remove': {
				try {
					let prompt = await this.prisma.selfAssignableRolePrompt.findFirst({
						where: { guildId: interaction.guild_id, promptId: args.remove.prompt },
						include: { selfAssignableRoles: true },
					});

					if (prompt?.guildId !== interaction.guild_id) {
						throw new Error('prompt guild id does not match interaction guild id');
					}

					await this.prisma.selfAssignableRole.delete({
						where: { roleId_promptId: { promptId: prompt.promptId, roleId: args.remove.role.id } },
					});

					// eslint-disable-next-line require-atomic-updates
					prompt = (await this.prisma.selfAssignableRolePrompt.findFirst({
						where: { guildId: interaction.guild_id, promptId: args.remove.prompt },
						include: { selfAssignableRoles: true },
					}))!;

					const rolesList = await (this.rest.get(Routes.guildRoles(interaction.guild_id)) as Promise<APIRole[]>).then(
						(roles) => roles.map((role): [string, APIRole] => [role.id, role]),
					);
					const roles = new Map(rolesList);

					let cleanedUp = 0;
					const deletedSelfAssignableRoles: Promise<SelfAssignableRole>[] = [];
					prompt.selfAssignableRoles = prompt.selfAssignableRoles.filter((role) => {
						if (!roles.has(role.roleId)) {
							deletedSelfAssignableRoles.push(
								this.prisma.selfAssignableRole.delete({
									where: { roleId_promptId: { promptId: prompt!.promptId, roleId: role.roleId } },
								}),
							);
							cleanedUp++;
							return false;
						}

						return true;
					});
					await Promise.allSettled(deletedSelfAssignableRoles);

					const body: RESTPatchAPIChannelMessageJSONBody = {
						components:
							prompt.useButtons && prompt.selfAssignableRoles.length <= 25
								? chunkArray(
										prompt.selfAssignableRoles.map(
											(role): APIButtonComponent => ({
												type: ComponentType.Button,
												label: roles.get(role.roleId)!.name,
												style: ButtonStyle.Secondary,
												disabled: !roles.has(role.roleId),
												custom_id: `roles-manage-simple|${role.roleId}`,
												emoji: role.emojiId
													? {
															id: role.emojiId,
															name: role.emojiName!,
															animated: role.emojiAnimated!,
													  }
													: undefined,
											}),
										),
										5,
								  ).map((components) => ({ type: ComponentType.ActionRow, components }))
								: [
										{
											type: ComponentType.ActionRow,
											components: [
												{
													type: ComponentType.Button,
													label: 'Manage your roles',
													style: ButtonStyle.Primary,
													custom_id: 'roles-manage-prompt',
												},
											],
										},
								  ],
					};
					await this.rest
						.patch(Routes.channelMessage(prompt.channelId, prompt.messageId), {
							body,
						})
						.catch(() => null);

					let content = 'Successfully removed the given role from the list of self assignable roles';

					if (cleanedUp) {
						content += ` and cleaned up ${cleanedUp} deleted roles`;
					}

					if (prompt.selfAssignableRoles.length <= 25 && prompt.useButtons) {
						content +=
							'\n\nNote: This prompt is at 25 or less roles, if it was using dropdowns previously because of the limit, switching back to buttons';
					}

					return await send(interaction, { content });
				} catch {
					throw new ControlFlowError('Could not find the given role');
				}
			}

			case 'list': {
				const prompts = await this.prisma.selfAssignableRolePrompt.findMany({
					where: { guildId: interaction.guild_id },
					include: { selfAssignableRoles: true },
				});

				if (!prompts.length) {
					return send(interaction, { content: 'There are no registered prompts' });
				}

				const data = prompts
					.map(
						(prompt) =>
							`• [Prompt ID ${prompt.promptId}](<https://discord.com/channels/${interaction.guild_id}/${prompt.channelId}/${prompt.messageId}>)`,
					)
					.join('\n');

				return send(interaction, {
					content: ellipsis(`**List of prompts and their self assignable roles**:\n${data}`, MESSAGE_LIMITS.CONTENT),
					allowed_mentions: { parse: [] },
				});
			}
		}
	}
}
