import * as interactions from '#interactions';
import type { ConfigCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import {
	ApiGetGuildsSettingsResult,
	ApiPatchGuildSettingsBody,
	ApiPatchGuildSettingsResult,
	GuildSettings,
	ms,
} from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@chatsift/api-wrapper';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import {
	APIApplicationCommandPermission,
	APIGuild,
	APIGuildInteraction,
	ApplicationCommandPermissionType,
	RESTPutAPIGuildApplicationCommandsPermissionsJSONBody,
	Routes,
	ChannelType,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler } from '../../handler';

@injectable()
export default class implements Command {
	public readonly userPermissions = UserPerms.admin;

	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly handler: Handler,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kConfig) public readonly config: Config,
		@inject(kSql) public readonly sql: Sql<{}>,
	) {}

	private _sendCurrentSettings(interaction: APIGuildInteraction, settings: Partial<GuildSettings>) {
		const atRole = (role?: string | null) => (role ? `<@&${role}>` : 'none');
		const atChannel = (channel?: string | null) => (channel ? `<#${channel}>` : 'none');

		return send(interaction, {
			content: stripIndents`
        **Here are your current settings:**
        • mod role: ${atRole(settings.mod_role)}
        • admin role: ${atRole(settings.admin_role)}
        • mute role: ${atRole(settings.mute_role)}
        • mod logs: ${atChannel(settings.mod_action_log_channel)}
        • filter logs: ${atChannel(settings.filter_trigger_log_channel)}
        • user logs: ${atChannel(settings.user_update_log_channel)}
        • message logs: ${atChannel(settings.message_update_log_channel)}
        • automatically pardon warnings after: ${
					settings.auto_pardon_warns_after ? `${settings.auto_pardon_warns_after} days` : 'never'
				}
        • automatically kick users with accounts younger than: ${
					settings.min_join_age ? ms(settings.min_join_age, true) : 'disabled'
				}
        • no blank avatar: ${settings.no_blank_avatar ? 'on' : 'off'}
        • reports: ${atChannel(settings.reports_channel)}
      `,
			allowed_mentions: { parse: [] },
		});
	}

	public parse(args: ArgumentsOf<typeof ConfigCommand>) {
		return {
			modrole: args.modrole,
			adminrole: args.adminrole,
			muterole: args.muterole,
			pardon: args.pardonwarnsafter,
			mod: args.modlogchannel,
			filters: args.filterslogchannel,
			users: args.userupdatelogchannel,
			messages: args.messageslogchannel,
			joinage: args.joinage,
			blankavatar: args.blankavatar,
			reports: args.reportschannel,
		};
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigCommand>) {
		const { modrole, adminrole, muterole, pardon, mod, filters, users, messages, joinage, blankavatar, reports } =
			this.parse(args);

		let settings: Partial<GuildSettings> = {};

		if (modrole) {
			settings.mod_role = modrole.id;
		}

		if (adminrole) {
			settings.admin_role = adminrole.id;
		}

		if (muterole) {
			settings.mute_role = muterole.id;
		}

		if (pardon != null) {
			settings.auto_pardon_warns_after = pardon;
		}

		const textTypes = [ChannelType.GuildText, ChannelType.GuildPublicThread, ChannelType.GuildPrivateThread];

		if (mod) {
			if (!textTypes.includes(mod.type)) {
				throw new ControlFlowError('Please provide a valid text channel');
			}

			settings.mod_action_log_channel = mod.id;
		}

		if (filters) {
			if (!textTypes.includes(filters.type)) {
				throw new ControlFlowError('Please provide a valid text channel');
			}

			settings.filter_trigger_log_channel = filters.id;
		}

		if (users) {
			if (!textTypes.includes(users.type)) {
				throw new ControlFlowError('Please provide a valid text channel');
			}

			settings.user_update_log_channel = users.id;
		}

		if (messages) {
			if (!textTypes.includes(messages.type)) {
				throw new ControlFlowError('Please provide a valid text channel');
			}

			settings.message_update_log_channel = messages.id;
		}

		if (joinage) {
			const joinageMinutes = Number(joinage);

			if (isNaN(joinageMinutes)) {
				const joinageMs = ms(joinage);
				if (!joinageMs) {
					throw new ControlFlowError('Failed to parse the provided duration');
				}

				settings.min_join_age = joinageMs;
			} else {
				settings.min_join_age = joinageMinutes * 6e4;
			}
		}

		if (blankavatar != null) {
			settings.no_blank_avatar = blankavatar;
		}

		if (reports) {
			if (!textTypes.includes(reports.type)) {
				throw new ControlFlowError('Please provide a valid text channel');
			}

			settings.reports_channel = reports.id;
		}

		settings = Object.values(settings).length
			? await this.rest.patch<ApiPatchGuildSettingsResult, ApiPatchGuildSettingsBody>(
					`/guilds/${interaction.guild_id}/settings`,
					settings,
			  )
			: await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);

		void this._sendCurrentSettings(interaction, settings);

		const guild = await this.discordRest.get<APIGuild>(Routes.guild(interaction.guild_id));

		await this.discordRest.put<unknown, RESTPutAPIGuildApplicationCommandsPermissionsJSONBody>(
			Routes.guildApplicationCommandsPermissions(this.config.discordClientId, interaction.guild_id),
			{
				data: Object.values(interactions).reduce<RESTPutAPIGuildApplicationCommandsPermissionsJSONBody>(
					(acc, entry) => {
						const id =
							this.config.nodeEnv === 'prod'
								? this.handler.globalCommandIds.get(entry.name)
								: this.handler.testGuildCommandIds.get(`${interaction.guild_id}-${entry.name}`);

						// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
						if ('default_permission' in entry && !entry.default_permission && id) {
							const permissions: APIApplicationCommandPermission[] = [];
							if ('perms' in entry) {
								const pushOwner = () =>
									void permissions.push({
										id: guild.owner_id,
										type: ApplicationCommandPermissionType.User,
										permission: true,
									});

								const pushAdmin = () =>
									settings.admin_role &&
									void permissions.push({
										id: settings.admin_role,
										type: ApplicationCommandPermissionType.Role,
										permission: true,
									});

								const pushMod = () =>
									settings.mod_role &&
									void permissions.push({
										id: settings.mod_role,
										type: ApplicationCommandPermissionType.Role,
										permission: true,
									});

								switch (entry.perms as UserPerms) {
									case UserPerms.none: {
										break;
									}

									case UserPerms.mod: {
										pushMod();
										pushAdmin();
										pushOwner();
										break;
									}

									case UserPerms.admin: {
										pushAdmin();
										pushOwner();
										break;
									}

									case UserPerms.owner: {
										pushOwner();
										break;
									}
								}
							}

							acc.push({
								id,
								permissions: [
									...permissions,
									...this.config.devIds.map((id) => ({
										id,
										type: ApplicationCommandPermissionType.User,
										permission: true,
									})),
								],
							});
						}

						return acc;
					},
					[],
				),
			},
		);
	}
}
