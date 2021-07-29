import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, send } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { ConfigCommand } from '#interactions';
import * as interactions from '#interactions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { Config, kConfig } from '@automoderator/injection';
import { stripIndents } from 'common-tags';
import { Handler } from '../../handler';
import {
  APIGuildInteraction,
  RESTPutAPIGuildApplicationCommandsPermissionsJSONBody,
  APIApplicationCommandPermission,
  ApplicationCommandPermissionType,
  Routes,
  APIGuild
} from 'discord-api-types/v9';
import type {
  ApiGetGuildsSettingsResult,
  ApiPatchGuildSettingsBody,
  ApiPatchGuildSettingsResult,
  GuildSettings
} from '@automoderator/core';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly handler: Handler,
    @inject(kConfig) public readonly config: Config
  ) {}

  private async _sendCurrentSettings(interaction: APIGuildInteraction) {
    const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);

    const atRole = (role?: string | null) => role ? `<@&${role}>` : 'none';

    return send(interaction, {
      content: stripIndents`
        **Here are your current settings:**
        • mod role: ${atRole(settings.mod_role)}
        • admin role: ${atRole(settings.admin_role)}
        • mute role: ${atRole(settings.mute_role)}
        • automatically pardon warnings after: ${settings.auto_pardon_mutes_after ? `${settings.auto_pardon_mutes_after} days` : 'never'}
      `,
      allowed_mentions: { parse: [] }
    });
  }

  public parse(args: ArgumentsOf<typeof ConfigCommand>) {
    return {
      modrole: args.modrole,
      adminrole: args.adminrole,
      muterole: args.muterole,
      pardon: args.pardonwarnsafter
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigCommand>) {
    const { modrole, adminrole, muterole, pardon } = this.parse(args);

    let settings: Partial<GuildSettings> = { guild_id: interaction.guild_id };

    if (modrole) settings.mod_role = modrole.id;
    if (adminrole) settings.admin_role = adminrole.id;
    if (muterole) settings.mute_role = muterole.id;
    if (pardon != null) settings.auto_pardon_mutes_after = pardon;

    if (Object.values(settings).length === 1) {
      return this._sendCurrentSettings(interaction);
    }

    settings = await this.rest.patch<ApiPatchGuildSettingsResult, ApiPatchGuildSettingsBody>(
      `/guilds/${interaction.guild_id}/settings`,
      settings
    );

    if (modrole || adminrole) {
      const guild = await this.discordRest.get<APIGuild>(Routes.guild(interaction.guild_id));
      const permissions: APIApplicationCommandPermission[] = [
        {
          id: guild.owner_id,
          type: ApplicationCommandPermissionType.User,
          permission: true
        }
      ];

      permissions.push(...this.config.devIds.map(id => ({ id, type: ApplicationCommandPermissionType.User, permission: true })));

      if (modrole) {
        permissions.push({
          id: modrole.id,
          type: ApplicationCommandPermissionType.Role,
          permission: true
        });
      }

      if (adminrole) {
        permissions.push({
          id: adminrole.id,
          type: ApplicationCommandPermissionType.Role,
          permission: true
        });
      }

      await this.discordRest.put<unknown, RESTPutAPIGuildApplicationCommandsPermissionsJSONBody>(
        Routes.guildApplicationCommandsPermissions(this.config.discordClientId, interaction.guild_id), {
          data: Object.values(interactions).reduce<RESTPutAPIGuildApplicationCommandsPermissionsJSONBody>((acc, entry) => {
            const id = this.config.nodeEnv === 'prod'
              ? this.handler.globalCommandIds.get(entry.name)
              : this.handler.testGuildCommandIds.get(`${interaction.guild_id}-${entry.name}`);

            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if ('default_permission' in entry && !entry.default_permission && id) {
              acc.push({ id, permissions });
            }

            return acc;
          }, [])
        }
      );
    }

    return this._sendCurrentSettings(interaction);
  }
}
