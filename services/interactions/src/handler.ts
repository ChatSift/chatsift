import { singleton, inject, container } from 'tsyringe';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { readdirRecurse } from '@gaius-bot/readdir';
import { join as joinPath } from 'path';
import { Command, commandInfo } from './command';
import { transformInteraction, ControlFlowError, send, PermissionsChecker, UserPerms, Interaction } from '#util';
import {
  Routes,
  RESTPutAPIApplicationCommandsResult,
  RESTPutAPIApplicationCommandsJSONBody,
  RESTPutAPIApplicationGuildCommandsResult,
  RESTPutAPIApplicationGuildCommandsJSONBody,
  APIApplicationCommandInteractionData,
  APIMessageButtonInteractionData,
  Snowflake
} from 'discord-api-types/v9';
import * as interactions from '#interactions';
import { Component, componentInfo } from './component';
import type { Logger } from 'pino';

@singleton()
export class Handler {
  public readonly commands = new Map<string, Command>();
  public readonly components = new Map<string, Component>();

  public readonly commandIds = new Map<string, Snowflake>();

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kLogger) public readonly logger: Logger,
    public readonly checker: PermissionsChecker,
    public readonly rest: Rest
  ) {}

  public async handleCommand(interaction: Interaction) {
    // TODO: Check on discord-api-types
    const data = interaction.data as APIApplicationCommandInteractionData | undefined;
    const command = this.commands.get(data?.name ?? '');

    if (!command) {
      return null;
    }

    try {
      if (command.userPermissions && !await this.checker.check(interaction, command.userPermissions)) {
        throw new ControlFlowError(
          `Missing permission to run this command! You must be at least \`${UserPerms[command.userPermissions]!}\``
        );
      }

      await command.exec(interaction, transformInteraction(data!.options ?? [], data!.resolved));
    } catch (e: any) {
      const internal = !(e instanceof ControlFlowError);

      if (internal) {
        this.logger.error({ error: e }, `Failed to execute command "${data!.name}"`);
      }

      const message = e.message ?? e.toString();

      void send(
        interaction, {
          content: internal
            ? `Something went wrong! It's possible the bot is missing permissions or that this is a bug.\n\`${message}\``
            : message,
          flags: 64
        }
      );
    }
  }

  public async handleComponent(interaction: Interaction) {
    const data = interaction.data as APIMessageButtonInteractionData | undefined;
    const [componentId, key, ...extra] = (data?.custom_id!.split('|') ?? []) as [string, string, ...string[]];
    const component = this.components.get(componentId ?? ''); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
    if (component && data) {
      try {
        if (component.userPermissions && !await this.checker.check(interaction, component.userPermissions)) {
          throw new ControlFlowError(
            `Missing permission to run this component! You must be at least \`${UserPerms[component.userPermissions]!}\``
          );
        }

        await component.exec(interaction, extra, key);
      } catch (e: any) {
        const internal = !(e instanceof ControlFlowError);

        if (internal) {
          this.logger.error({ error: e }, `Failed to execute component "${data.custom_id}"`);
        }

        const message = e.message ?? e.toString();

        void send(interaction, {
          content: internal
            ? `Something went wrong! It's possible that the bot is missing permissions or that this is a bug.\n\`${message}\``
            : message,
          flags: 64
        });
      }
    }
  }

  public async registerInteractions(): Promise<void> {
    const promises = [];

    if (this.config.nodeEnv === 'prod') {
      const res = await this.rest.put<RESTPutAPIApplicationCommandsResult, RESTPutAPIApplicationCommandsJSONBody>(
        Routes.applicationCommands(this.config.discordClientId), {
          data: Object.values(interactions as any)
        }
      );

      for (const command of res) {
        this.commandIds.set(command.name, command.id);
      }

      for (const guild of this.config.interactionsTestGuilds) {
        const promise = this.rest.put<unknown, RESTPutAPIApplicationCommandsJSONBody>(
          Routes.applicationGuildCommands(this.config.discordClientId, guild), {
            data: []
          }
        );

        promises.push(promise);
      }

      await Promise.allSettled(promises);
      return;
    }

    await this.rest.put<unknown, RESTPutAPIApplicationCommandsJSONBody>(Routes.applicationCommands(this.config.discordClientId), {
      data: []
    });

    for (const guild of this.config.interactionsTestGuilds) {
      const promise = this.rest.put<RESTPutAPIApplicationGuildCommandsResult, RESTPutAPIApplicationGuildCommandsJSONBody>(
        Routes.applicationGuildCommands(this.config.discordClientId, guild), {
          data: Object.values(interactions as any)
        }
      );

      promises.push(promise);
    }

    for (const promise of await Promise.allSettled(promises)) {
      if (promise.status === 'fulfilled') {
        for (const command of promise.value) {
          this.commandIds.set(command.name, command.id);
        }

        break;
      }
    }
  }

  public async loadCommands(): Promise<void> {
    for await (const file of readdirRecurse(joinPath(__dirname, 'commands'), { fileExtension: 'js' })) {
      if (file.includes('/sub/')) {
        continue;
      }

      const info = commandInfo(file);

      if (!info) {
        continue;
      }

      const command: Command = container.resolve((await import(file)).default);
      this.commands.set(command.name ?? info.name, command);
    }
  }

  public async loadComponents(): Promise<void> {
    for await (const file of readdirRecurse(joinPath(__dirname, 'components'), { fileExtension: 'js' })) {
      const info = componentInfo(file);

      if (!info) {
        continue;
      }

      const component: Component = container.resolve((await import(file)).default);
      this.components.set(component.name ?? info.name, component);
    }
  }

  public async init(): Promise<void> {
    await this.registerInteractions();
    await this.loadCommands();
    await this.loadComponents();
  }
}
