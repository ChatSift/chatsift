import { injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { FilterCommand } from '#interactions';
import { FilterConfig, UrlsConfig, InvitesConfig } from './sub/filter';
import type { APIGuildInteraction } from 'discord-api-types/v9';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly config: FilterConfig,
    public readonly urls: UrlsConfig,
    public readonly invites: InvitesConfig
  ) {}

  public exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'config': {
        return this.config.exec(interaction, args.config);
      }

      case 'urls': {
        return this.urls.exec(interaction, args.urls);
      }

      case 'invites': {
        return this.invites.exec(interaction, args.invites);
      }
    }
  }
}
