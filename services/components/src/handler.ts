import { container, singleton, inject } from 'tsyringe';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { send, ControlFlowError, PermissionsChecker, UserPerms } from '@automoderator/interaction-util';
import { readdirRecurse } from '@gaius-bot/readdir';
import { join as joinPath } from 'path';
import { Component, componentInfo } from './component';
import { createAmqp, RoutingClient } from '@cordis/brokers';
import { DiscordInteractions } from '@automoderator/core';
import type { APIGuildInteraction, APIMessageButtonInteractionData } from 'discord-api-types/v8';
import type { Logger } from 'pino';

@singleton()
export class Handler {
  public readonly components = new Map<string, Component>();

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kLogger) public readonly logger: Logger,
    public readonly checker: PermissionsChecker,
    public readonly rest: Rest
  ) {}

  private async _handleInteraction(interaction: APIGuildInteraction) {
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
      } catch (error) {
        const internal = !(error instanceof ControlFlowError);

        if (internal) {
          this.logger.error({ error }, `Failed to execute component "${data.custom_id}"`);
        }

        void send(interaction, {
          content: internal
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            ? `Something went wrong! It's possible that the bot is missing permissions or that this is a bug.\n\`${error.message}\``
            : error.message,
          flags: 64
        });
      }
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

  public async init() {
    const { channel } = await createAmqp(this.config.amqpUrl);
    const interactions = new RoutingClient<keyof DiscordInteractions, DiscordInteractions>(channel);

    interactions.on('component', interaction => void this._handleInteraction(interaction));

    await interactions.init({ name: 'interactions', topicBased: false, keys: ['component'] });

    await this.loadComponents();

    return interactions;
  }
}
