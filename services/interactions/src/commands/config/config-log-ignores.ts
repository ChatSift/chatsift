import { ConfigAutomodIgnoresCommand } from '#interactions';
import { ArgumentsOf, FilterIgnoresStateStore } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  APIGuildInteraction
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly filterIgnoreState: FilterIgnoresStateStore
  ) {}

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigAutomodIgnoresCommand>) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'show': {

      }

      case 'update': {

      }
    }
  }
}
