import type { RolesCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { chunkArray } from '@chatsift/utils';
import { kLogger } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import {
	APIActionRowComponent,
	APIGuildInteraction,
	APIButtonComponent,
	APIMessage,
	APIRole,
	RESTPostAPIChannelMessageJSONBody,
	RESTPatchAPIChannelMessageJSONBody,
	APIMessageActionRowComponent,
	ButtonStyle,
	ComponentType,
	Routes,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import { PrismaClient, SelfAssignableRole, SelfAssignableRolePrompt } from '@prisma/client';
import { ellipsis, MESSAGE_LIMITS } from '@chatsift/discord-utils';

@injectable()
export default class implements Command {
	public constructor(
		public readonly discordRest: DiscordRest,
		@inject(kLogger) public readonly logger: Logger,
		public readonly prisma: PrismaClient,
	) {}

	private async handlePrompt(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RolesCommand>['prompt']) {
		switch (Object.keys(args)[0] as 're-display' | 'delete' | 'create') {
			case 're-display': {
				const prompt = await this.prisma.selfAssignableRolePrompt.findFirst({
					where: { guildId: interaction.guild_id, promptId: args['re-display'].id },
					include: { selfAssignableRoles: true },
				});

				if (!prompt) {
					throw new ControlFlowError('Could not find prompt');
				}

				const rolesList = await this.discordRest
					.get<APIRole[]>(Routes.guildRoles(interaction.guild_id))
					.then((roles) => roles.map((r): [string, APIRole] => [r.id, r]));

				const roles = new Map(rolesList);

				let cleanedUp = 0;
				prompt.selfAssignableRoles = prompt.selfAssignableRoles.filter((r) => {
					if (!roles.has(r.roleId)) {
						void this.prisma.selfAssignableRole
							.delete({ where: { roleId_promptId: { promptId: prompt.promptId, roleId: r.roleId } } })
							.catch(() => null);
						cleanedUp++;
						return false;
					}

					return true;
				});

				const promptMessage = await this.discordRest.post<APIMessage, RESTPostAPIChannelMessageJSONBody>(
					Routes.channelMessages(args['re-display'].channel?.id ?? interaction.channel_id!),
					{
						data: {
							embed: {
								title: prompt.embedTitle ?? undefined,
								color: prompt.embedColor,
								description: prompt.embedDescription ?? undefined,
								image: prompt.embedImage
									? {
											url: prompt.embedImage,
									  }
									: undefined,
							},
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
						},
					},
				);

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
						throw new Error();
					}

					await this.prisma.selfAssignableRolePrompt.delete({ where: { promptId: args.delete.id } });
					return await send(interaction, { content: 'Successfully deleted your prompt' });
				} catch (error) {
					throw new ControlFlowError('Could not find prompt to delete');
				}
			}

			case 'create': {
				if (!Object.keys(args.create).length) {
					throw new ControlFlowError('Please provide at least one of the options');
				}

				const channelId = args.create.channel?.id ?? interaction.channel_id!;
				const color = args.create.color ? parseInt(args.create.color.replace('#', ''), 16) : 5793266;

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

				const promptMessage = await this.discordRest.post<APIMessage, RESTPostAPIChannelMessageJSONBody>(
					Routes.channelMessages(channelId),
					{
						data: {
							embed: {
								title: args.create.title,
								color,
								description: args.create.description,
								image: args.create.imageurl
									? {
											url: args.create.imageurl,
									  }
									: undefined,
							},
							components,
						},
					},
				);

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
		switch (Object.keys(args)[0] as 'prompt' | 'add' | 'remove' | 'list') {
			case 'prompt': {
				return this.handlePrompt(interaction, args.prompt);
			}

			case 'add': {
				try {
					let emoji;
					if (args.add.emoji) {
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
						throw new Error();
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

					const rolesList = await this.discordRest
						.get<APIRole[]>(Routes.guildRoles(interaction.guild_id))
						.then((roles) => roles.map((r): [string, APIRole] => [r.id, r]));
					const roles = new Map(rolesList);

					let cleanedUp = 0;
					prompt.selfAssignableRoles = prompt.selfAssignableRoles.filter((r) => {
						if (!roles.has(r.roleId)) {
							cleanedUp++;
							return false;
						}

						return true;
					});

					await this.discordRest
						.patch<unknown, RESTPatchAPIChannelMessageJSONBody>(
							Routes.channelMessage(prompt.channelId, prompt.messageId),
							{
								data: {
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
								},
							},
						)
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
						throw new Error();
					}

					await this.prisma.selfAssignableRole.delete({
						where: { roleId_promptId: { promptId: prompt.promptId, roleId: args.remove.role.id } },
					});

					prompt = (await this.prisma.selfAssignableRolePrompt.findFirst({
						where: { guildId: interaction.guild_id, promptId: args.remove.prompt },
						include: { selfAssignableRoles: true },
					}))!;

					const rolesList = await this.discordRest
						.get<APIRole[]>(Routes.guildRoles(interaction.guild_id))
						.then((roles) => roles.map((r): [string, APIRole] => [r.id, r]));
					const roles = new Map(rolesList);

					let cleanedUp = 0;
					prompt.selfAssignableRoles = prompt.selfAssignableRoles.filter((r) => {
						if (!roles.has(r.roleId)) {
							void this.prisma.selfAssignableRole
								.delete({ where: { roleId_promptId: { promptId: prompt!.promptId, roleId: r.roleId } } })
								.catch(() => null);
							cleanedUp++;
							return false;
						}

						return true;
					});

					await this.discordRest
						.patch<unknown, RESTPatchAPIChannelMessageJSONBody>(
							Routes.channelMessage(prompt.channelId, prompt.messageId),
							{
								data: {
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
								},
							},
						)
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
					.map((prompt) => {
						const formatPrompt = (prompt: SelfAssignableRolePrompt) =>
							`[Prompt ID ${prompt.promptId}](<https://discord.com/channels/${interaction.guild_id}/${prompt.channelId}/${prompt.messageId}>)`;

						const formatRoles = (roles: SelfAssignableRole[]) =>
							roles.length ? roles.map((r) => `<@&${r.roleId}>`).join(', ') : 'no roles - please set some';

						return `• ${formatPrompt(prompt)}: ${formatRoles(prompt.selfAssignableRoles)}`;
					})
					.join('\n');

				return send(interaction, {
					content: ellipsis(`**List of prompts and their self assignable roles**:\n${data}`, MESSAGE_LIMITS.CONTENT),
					allowed_mentions: { parse: [] },
				});
			}
		}
	}
}
