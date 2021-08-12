import { FilterCommand } from '#interactions';
import { ArgumentsOf } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Command } from '../../command';
import { FilterConfig, InvitesConfig } from './sub/filter';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly config: FilterConfig,
    public readonly invites: InvitesConfig
  ) {}

  public exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'config': {
        return this.config.exec(interaction, args.config);
      }

      case 'invites': {
        return this.invites.exec(interaction, args.invites);
      }
    }
  }
}
