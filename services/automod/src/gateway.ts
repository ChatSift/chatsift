import { inject, singleton } from 'tsyringe';
import { Config, kConfig, kSql } from '@automoderator/injection';
import { createAmqp, RoutingClient } from '@cordis/brokers';
import { GatewayDispatchEvents, GatewayMessageUpdateDispatchData } from 'discord-api-types/v8';
import type { DiscordEvents } from '@cordis/common';
import type { Sql } from 'postgres';
import type { GuildSettings } from '@automoderator/core';

@singleton()
export class Gateway {
  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private async onMessage(message: GatewayMessageUpdateDispatchData) {
    if (!message.guild_id || !message.content?.length) return;

    const [
      settings = {
        use_global_url_filters: false
      }
    ] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${message.guild_id}`;

    const checks = 0;
    try {

    } catch {

    }
  }

  public async init() {
    const { channel } = await createAmqp(this.config.amqpUrl);
    const gateway = new RoutingClient<keyof DiscordEvents, DiscordEvents>(channel);

    gateway
      .on(GatewayDispatchEvents.MessageCreate, message => void this.onMessage(message))
      .on(GatewayDispatchEvents.MessageUpdate, message => void this.onMessage(message));

    await gateway.init({
      name: 'gateway',
      keys: [GatewayDispatchEvents.MessageCreate, GatewayDispatchEvents.MessageUpdate],
      queue: 'automod'
    });

    return gateway;
  }
}
