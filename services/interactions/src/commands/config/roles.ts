import type { RolesCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import {
	ApiGetGuildPromptResult,
	ApiGetGuildPromptsResult,
	ApiPatchGuildPromptBody,
	ApiPutGuildsAssignablesRoleBody,
	SelfAssignableRolePrompt,
	ApiPutGuildPromptsBody,
	ApiPutGuildPromptsResult,
	SelfAssignableRole,
	sectionArray,
} from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { HTTPError, Rest } from '@automoderator/http-client';
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
	ButtonStyle,
	ComponentType,
	Routes,
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';

@injectable()
export default class implements Command {
	public readonly userPermissions = UserPerms.admin;

	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		@inject(kLogger) public readonly logger: Logger,
	) {}

	private handleHttpError(interaction: APIGuildInteraction, error: HTTPError) {
		switch (error.statusCode) {
			case 404:
			case 409: {
				return send(interaction, { content: error.message, flags: 64 });
			}

			default: {
				throw error;
			}
		}
	}

	private async handlePrompt(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RolesCommand>['prompt']) {
		switch (Object.keys(args)[0] as 're-display' | 'delete' | 'create') {
			case 're-display': {
				const prompt = await this.rest.get<ApiGetGuildPromptResult>(
					`/guilds/${interaction.guild_id}/prompts/${args['re-display'].id}`,
				);
				const roles = new Map(
					await this.discordRest
						.get<APIRole[]>(Routes.guildRoles(interaction.guild_id))
						.then((roles) => roles.map((r) => [r.id, r])),
				);

				let cleanedUp = 0;
				prompt.roles = prompt.roles.filter((r) => {
					if (!roles.has(r.role_id)) {
						void this.rest.delete(`/guilds/${interaction.guild_id}/assignables/roles/$${r.role_id}`).catch(() => null);
						cleanedUp++;
						return false;
					}

					return true;
				});

				const promptMessage = await this.discordRest.post<APIMessage, RESTPostAPIChannelMessageJSONBody>(
					Routes.channelMessages(args['re-display'].channel?.id ?? interaction.channel_id),
					{
						data: {
							embed: {
								title: prompt.embed_title,
								color: prompt.embed_color,
								description: prompt.embed_description ?? undefined,
								image: prompt.embed_image
									? {
											url: prompt.embed_image,
									  }
									: undefined,
							},
							components:
								prompt.use_buttons && prompt.roles.length <= 25
									? sectionArray(
											prompt.roles.map(
												(role): APIButtonComponent => ({
													type: ComponentType.Button,
													label: roles.get(role.role_id)!.name,
													style: ButtonStyle.Secondary,
													custom_id: `roles-manage-simple|${nanoid()}|${role.role_id}`,
													emoji: role.emoji_id
														? {
																id: role.emoji_id,
																name: role.emoji_name,
																animated: role.emoji_animated,
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
														custom_id: `roles-manage-prompt|${nanoid()}`,
													},
												],
											},
									  ],
						},
					},
				);

				await this.rest.patch<unknown, ApiPatchGuildPromptBody>(
					`/guilds/${interaction.guild_id}/prompts/${args['re-display'].id}`,
					{
						channel_id: promptMessage.channel_id,
						message_id: promptMessage.id,
					},
				);

				return send(interaction, {
					content: `Successfully re-posted the prompt${cleanedUp ? ` and cleaned up ${cleanedUp} deleted roles` : ''}`,
					flags: 64,
				});
			}

			case 'delete': {
				try {
					await this.rest.delete<unknown>(`/guilds/${interaction.guild_id}/prompts/${args.delete.id}`);
					return await send(interaction, { content: 'Successfully deleted your prompt' });
				} catch (error) {
					if (error instanceof HTTPError) {
						return this.handleHttpError(interaction, error);
					}

					throw error;
				}
			}

			case 'create': {
				const channelId = args.create.channel?.id ?? interaction.channel_id;
				const color = args.create.color ? parseInt(args.create.color.replace('#', ''), 16) : 5793266;

				const components: APIActionRowComponent[] =
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
											custom_id: `roles-manage-prompt|${nanoid()}`,
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

				const prompt = await this.rest.put<ApiPutGuildPromptsResult, ApiPutGuildPromptsBody>(
					`/guilds/${interaction.guild_id}/prompts`,
					{
						channel_id: channelId,
						message_id: promptMessage.id,
						embed_color: color,
						embed_title: args.create.title,
						embed_description: args.create.description,
						embed_image: args.create.imageurl,
						use_buttons: args.create.usebuttons ?? false,
					},
				);

				return send(interaction, {
					content: `Successfully created your prompt with an id of ${prompt.prompt_id}`,
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

					await this.rest.put<unknown, ApiPutGuildsAssignablesRoleBody>(
						`/guilds/${interaction.guild_id}/assignables/roles/${args.add.role.id}`,
						{
							prompt_id: args.add.prompt,
							emoji,
						},
					);

					const prompt = await this.rest.get<ApiGetGuildPromptResult>(
						`/guilds/${interaction.guild_id}/prompts/${args.add.prompt}`,
					);
					const roles = new Map(
						await this.discordRest
							.get<APIRole[]>(Routes.guildRoles(interaction.guild_id))
							.then((roles) => roles.map((r) => [r.id, r])),
					);

					let cleanedUp = 0;
					prompt.roles = prompt.roles.filter((r) => {
						if (!roles.has(r.role_id)) {
							cleanedUp++;
							return false;
						}

						return true;
					});

					await this.discordRest
						.patch<unknown, RESTPatchAPIChannelMessageJSONBody>(
							Routes.channelMessage(prompt.channel_id, prompt.message_id),
							{
								data: {
									components:
										prompt.use_buttons && prompt.roles.length <= 25
											? sectionArray(
													prompt.roles.map(
														(role): APIButtonComponent => ({
															type: ComponentType.Button,
															label: roles.get(role.role_id)!.name,
															style: ButtonStyle.Secondary,
															custom_id: `roles-manage-simple|${nanoid()}|${role.role_id}`,
															emoji: role.emoji_id
																? {
																		id: role.emoji_id,
																		name: role.emoji_name,
																		animated: role.emoji_animated,
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
																custom_id: `roles-manage-prompt|${nanoid()}`,
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

					if (prompt.roles.length > 25 && prompt.use_buttons) {
						content += "\n\nWARNING: You've gone above 25 buttons, switching to dropdown";
					}

					return await send(interaction, { content });
				} catch (error) {
					if (error instanceof HTTPError) {
						return this.handleHttpError(interaction, error);
					}

					throw error;
				}
			}

			case 'remove': {
				try {
					await this.rest.delete(`/guilds/${interaction.guild_id}/assignables/roles/${args.remove.role.id}`);

					const prompt = await this.rest.get<ApiGetGuildPromptResult>(
						`/guilds/${interaction.guild_id}/prompts/${args.remove.prompt}`,
					);
					const roles = new Map(
						await this.discordRest
							.get<APIRole[]>(Routes.guildRoles(interaction.guild_id))
							.then((roles) => roles.map((r) => [r.id, r])),
					);

					let cleanedUp = 0;
					prompt.roles = prompt.roles.filter((r) => {
						if (!roles.has(r.role_id)) {
							void this.rest
								.delete(`/guilds/${interaction.guild_id}/assignables/roles/$${r.role_id}`)
								.catch(() => null);
							cleanedUp++;
							return false;
						}

						return true;
					});

					await this.discordRest
						.patch<unknown, RESTPatchAPIChannelMessageJSONBody>(
							Routes.channelMessage(prompt.channel_id, prompt.message_id),
							{
								data: {
									components:
										prompt.use_buttons && prompt.roles.length <= 25
											? sectionArray(
													prompt.roles.map(
														(role): APIButtonComponent => ({
															type: ComponentType.Button,
															label: roles.get(role.role_id)!.name,
															style: ButtonStyle.Secondary,
															disabled: !roles.has(role.role_id),
															custom_id: `roles-manage-simple|${nanoid()}|${role.role_id}`,
															emoji: role.emoji_id
																? {
																		id: role.emoji_id,
																		name: role.emoji_name,
																		animated: role.emoji_animated,
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
																custom_id: `roles-manage-prompt|${nanoid()}`,
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

					if (prompt.roles.length <= 3 && prompt.use_buttons) {
						content += '\n\nNote: Back to 25 or less roles, switching back to buttons';
					}

					return await send(interaction, { content });
				} catch (error) {
					if (error instanceof HTTPError) {
						return this.handleHttpError(interaction, error);
					}

					throw error;
				}
			}

			case 'list': {
				const prompts = await this.rest.get<ApiGetGuildPromptsResult>(`/guilds/${interaction.guild_id}/prompts`);
				if (!prompts.length) {
					return send(interaction, { content: 'There are no registered prompts' });
				}

				const data = prompts
					.map((prompt) => {
						const formatPrompt = (prompt: SelfAssignableRolePrompt) =>
							`[Prompt ID ${prompt.prompt_id}](<https://discord.com/channels/${interaction.guild_id}/${prompt.channel_id}/${prompt.message_id}>)`;

						const formatRoles = (roles: SelfAssignableRole[]) =>
							roles.length ? roles.map((r) => `<@&${r.role_id}>`).join(', ') : 'no roles - please set some';

						return `• ${formatPrompt(prompt)}: ${formatRoles(prompt.roles)}`;
					})
					.join('\n');

				return send(interaction, {
					content: `**List of prompts and their self assignable roles**:\n${data}`,
					allowed_mentions: { parse: [] },
				});
			}
		}
	}
}
