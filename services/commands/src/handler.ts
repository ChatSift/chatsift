import { singleton, inject } from 'tsyringe';
import { createAmqp, RoutingClient } from '@cordis/brokers';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { readdirRecurse } from '@gaius-bot/readdir';
import { join as joinPath } from 'path';
import {
  Routes,
  RESTPutAPIApplicationCommandsJSONBody,
  RESTPostAPIApplicationCommandsJSONBody
} from 'discord-api-types/v8';
import type { DiscordInteractions } from '@automoderator/core';
import type { Logger } from 'pino';

@singleton()
export class Handler {
  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kLogger) public readonly logger: Logger,
    public readonly rest: Rest
  ) {}

  public async registerInteractions(): Promise<void> {
    const interactions = [];

    for await (const file of readdirRecurse(joinPath(__dirname, 'interactions'), { fileExtension: 'js' })) {
      const data: RESTPostAPIApplicationCommandsJSONBody = (await import(file)).default;
      interactions.push(data);
    }

    const commandsRoute = this.config.nodeEnv === 'prod'
      ? Routes.applicationCommands(this.config.discordClientId)
      : Routes.applicationGuildCommands(this.config.discordClientId, this.config.interactionsTestGuildId);

    await this.rest.put<unknown, RESTPutAPIApplicationCommandsJSONBody>(commandsRoute, { data: interactions });
  }

  public async init() {
    await this.registerInteractions();

    const { channel } = await createAmqp(this.config.amqpUrl);
    const interactions = new RoutingClient<keyof DiscordInteractions, DiscordInteractions>(channel);

    await interactions.init({ name: 'interactions', topicBased: false, keys: ['command'] });

    return interactions;
  }
}
