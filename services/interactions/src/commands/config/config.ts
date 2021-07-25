import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, send, UserPerms } from '#util';
import { ConfigCommand } from '#interactions';
import * as interactions from '#interactions';
import { Rest } from '@cordis/rest';
import { Config, kConfig, kSql } from '@automoderator/injection';
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
import type { GuildSettings } from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    public readonly handler: Handler,
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kConfig) public readonly config: Config
  ) {}

  private _sendCurrentSettings(message: APIGuildInteraction, settings?: Partial<GuildSettings>) {
    const atRole = (role?: string | null) => role ? `<@&${role}>` : 'none';

    return send(message, {
      content: stripIndents`
        **Here are your current settings:**
        • mod role: ${atRole(settings?.mod_role)}
        • admin role: ${atRole(settings?.admin_role)}
        • mute role: ${atRole(settings?.mute_role)}
        • automatically pardon warnings after: ${settings?.auto_pardon_mutes_after ? `${settings.auto_pardon_mutes_after} days` : 'never'}
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
      const [currentSettings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;
      return this._sendCurrentSettings(interaction, currentSettings);
    }

    [settings] = await this.sql`
      INSERT INTO guild_settings ${this.sql(settings)}
      ON CONFLICT (guild_id)
      DO
        UPDATE SET ${this.sql(settings)}
        RETURNING *
    `;

    if (modrole || adminrole) {
      const guild = await this.rest.get<APIGuild>(Routes.guild(interaction.guild_id));
      const permissions: APIApplicationCommandPermission[] = [
        {
          id: guild.owner_id,
          type: ApplicationCommandPermissionType.User,
          permission: true
        }
      ];

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

      await this.rest.put<unknown, RESTPutAPIGuildApplicationCommandsPermissionsJSONBody>(
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

    return this._sendCurrentSettings(interaction, settings);
  }
}
