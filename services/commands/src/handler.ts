import { singleton, inject } from 'tsyringe';
import { createAmqp, RoutingClient } from '@cordis/brokers';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { readdirRecurse } from '@gaius-bot/readdir';
import { join as joinPath } from 'path';
import Command from './command';
import { ControlFlowError, send, transformInteraction } from '#util';
import {
  Routes,
  RESTPutAPIApplicationCommandsJSONBody,
  RESTPostAPIApplicationCommandsJSONBody,
  APIGuildInteraction,
  APIApplicationCommandInteractionData
} from 'discord-api-types/v8';
import type { DiscordInteractions } from '@automoderator/core';
import type { Logger } from 'pino';

@singleton()
export class Handler {
  public readonly commands = new Map<string, Command>();

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kLogger) public readonly logger: Logger,
    public readonly rest: Rest
  ) {}

  private async _handleInteraction(interaction: APIGuildInteraction) {
    // TODO: Check on discord-api-types
    const data = interaction.data as APIApplicationCommandInteractionData | undefined;
    const command = this.commands.get(data?.name ?? '');

    if (!command) {
      return null;
    }

    try {
      await command.exec(interaction, transformInteraction(data!.options ?? [], data!.resolved));
    } catch (e) {
      const internal = !(e instanceof ControlFlowError);

      if (internal) {
        this.logger.error({ error: e }, `Failed to execute command "${data!.name}"`);
      }

      void send(
        interaction, {
          content: internal
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            ? `Something went wrong internally! You should never see an error message like this, please contact a developer.\n${e.message}`
            : e.message,
          flags: 64
        }
      );
    }
  }

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

    interactions.on('command', interaction => void this._handleInteraction(interaction as APIGuildInteraction));

    await interactions.init({ name: 'interactions', topicBased: false, keys: ['command'] });

    return interactions;
  }
}
