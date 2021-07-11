import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf } from '#util';
import { send, UserPerms } from '@automoderator/interaction-util';
import { RolesCommand } from '#interactions';
import { Rest } from '@cordis/rest';
import { APIGuildInteraction, ButtonStyle, ComponentType } from 'discord-api-types/v8';
import { kSql } from '@automoderator/injection';
import { GuildSettings } from '@automoderator/core';
import { nanoid } from 'nanoid';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RolesCommand>) {
    switch (Object.keys(args)[0] as 'prompt' | 'add' | 'remove') {
      case 'prompt': {
        const [{ assignable_roles_prompt: prompt = null } = {}] = await this.sql<[Pick<GuildSettings, 'assignable_roles_prompt'>?]>`
          SELECT assignable_roles_prompt
          FROM guild_settings
          WHERE guild_id = ${interaction.guild_id}
        `;

        return send(interaction, {
          embed: {
            title: 'Hey there! How about if we get you set up with some roles?',
            color: 5793266,
            description: prompt ?? 'Use the button bellow to create a dropdown that allows you to manage your roles!'
          },
          // @ts-expect-error
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  label: 'Manage your roles',
                  style: ButtonStyle.Primary,
                  custom_id: `roles-manage|${nanoid()}`
                }
              ]
            }
          ]
        });
      }

      case 'add': {
        await this.sql`INSERT INTO self_assignable_roles (role_id, guild_id) VALUES (${args.add.role.id}, ${interaction.guild_id})`;
        return send(interaction, { content: 'Successfully registered the given role as a self assignable role' });
      }

      case 'remove': {
        await this.sql`DELETE FROM self_assignable_roles WHERE role_id = ${args.add.role.id}`;
        return send(interaction, { content: 'Successfully registered the given role as a self assignable role' });
      }
    }
  }
}
