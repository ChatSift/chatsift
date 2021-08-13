import { RaidCleanupCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { HTTPError, Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
  ) {}

  public parse(args: ArgumentsOf<typeof RaidCleanupCommand>) {
    return {
      join: args.join,
      age: args.age
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RaidCleanupCommand>) {
    const { join, age } = this.parse(args);

    if (join == null && age == null) {
      throw new ControlFlowError('You must pass at least one of the given arguments');
    }
  }
}
