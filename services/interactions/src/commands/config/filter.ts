import { injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, UserPerms } from '#util';
import { FilterCommand } from '#interactions';
import { FilterConfig, FilesConfig, UrlsConfig, InvitesConfig } from './sub/filter';
import type { APIGuildInteraction } from 'discord-api-types/v9';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly config: FilterConfig,
    public readonly urls: UrlsConfig,
    public readonly files: FilesConfig,
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

      case 'files': {
        return this.files.exec(interaction, args.files);
      }

      case 'invites': {
        return this.invites.exec(interaction, args.invites);
      }
    }
  }
}
