import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { RolesCommand } from '#interactions';
import { Rest } from '@cordis/rest';
import { APIGuildInteraction, ButtonStyle, ComponentType } from 'discord-api-types/v9';
import { kSql } from '@automoderator/injection';
import { GuildSettings, SelfAssignableRole } from '@automoderator/core';
import { nanoid } from 'nanoid';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private async handlePrompt(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RolesCommand['options'][0]>) {
    switch (Object.keys(args)[0] as 'display' | 'set') {
      case 'display': {
        const [{ assignable_roles_prompt: prompt = null } = {}] = await this.sql<[Pick<GuildSettings, 'assignable_roles_prompt'>?]>`
          SELECT assignable_roles_prompt
          FROM guild_settings
          WHERE guild_id = ${interaction.guild_id}
        `;

        const { token, ...message } = interaction;
        await send(message, {
          embed: {
            title: 'Hey there! How about if we get you set up with some roles?',
            color: 5793266,
            description: prompt ?? 'Use the button below to create a dropdown that allows you to manage your roles!'
          },
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  label: 'Manage your roles',
                  style: ButtonStyle.Primary,
                  custom_id: `roles-manage-prompt|${nanoid()}`
                }
              ]
            }
          ]
        });

        return send(interaction, { content: 'Successfully posted the prompt', flags: 64 });
      }

      case 'set': {
        await this.sql`
          INSERT INTO guild_settings (guild_id, assignable_roles_prompt)
          VALUES (${interaction.guild_id}, ${args.set.prompt})
          ON CONFLICT (guild_id)
          DO
            UPDATE SET assignable_roles_prompt = ${args.set.prompt}
        `;
        return send(interaction, { content: 'Successfully updated your prompt' });
      }
    }
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RolesCommand>) {
    switch (Object.keys(args)[0] as 'prompt' | 'add' | 'remove' | 'list') {
      case 'prompt': {
        return this.handlePrompt(interaction, args.prompt);
      }

      case 'add': {
        const count = await this.sql`SELECT * FROM self_assignable_roles WHERE guild_id = ${interaction.guild_id}`.then(rows => rows.length);
        if (count >= 15) {
          throw new ControlFlowError('You already have 15 self assignable roles!');
        }

        const [role] = await this.sql<[SelfAssignableRole?]>`
          INSERT INTO self_assignable_roles (role_id, guild_id)
          VALUES (${args.add.role.id}, ${interaction.guild_id})
          ON CONFLICT DO NOTHING
          RETURNING *
        `;

        if (!role) {
          return send(interaction, { content: 'That role is already self assignable', flags: 64 });
        }

        return send(interaction, { content: 'Successfully registered the given role as a self assignable role' });
      }

      case 'remove': {
        const [role] = await this.sql<[SelfAssignableRole?]>`
          DELETE FROM self_assignable_roles
          WHERE role_id = ${args.remove.role.id}
          RETURNING *
        `;

        if (!role) {
          return send(interaction, { content: 'That role is not currently self assignable', flags: 64 });
        }

        return send(interaction, { content: 'Successfully removed the given role from the list of self assignable roles' });
      }

      case 'list': {
        const roles = await this.sql<SelfAssignableRole[]>`SELECT * FROM self_assignable_roles WHERE guild_id = ${interaction.guild_id}`;
        if (!roles.length) {
          return send(interaction, { content: 'There are no currently self assignable roles' });
        }

        return send(interaction, {
          content: `List of currently self assignable roles: ${roles.map(r => `<@&${r.role_id}>`).join(', ')}`,
          allowed_mentions: { parse: [] }
        });
      }
    }
  }
}
