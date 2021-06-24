import { inject, singleton } from 'tsyringe';
import { Config, kConfig, kLogger, kRest, kSql } from '@automoderator/injection';
import { createAmqp, RoutingClient } from '@cordis/brokers';
import { GatewayDispatchEvents, GatewayMessageUpdateDispatchData } from 'discord-api-types/v8';
import { ApiPostFiltersUrlsResult, GuildSettings, UseGlobalUrlFiltersMode } from '@automoderator/core';
import type { DiscordEvents } from '@cordis/common';
import type { Sql } from 'postgres';
import type { Logger } from 'pino';
import type { UrlsRunner } from './runners';
import type { IRouter as DiscordIRouter } from '@cordis/rest';

enum Runners {
  urls
}

interface Runner {
  runner: Runners;
}

interface NotOkRunnerResult extends Runner {
  ok: false;
}

interface OkRunnerResult<R extends Runners, T> extends Runner {
  ok: true;
  runner: R;
  data: T;
  actioned: boolean;
}

interface UrlsRunnerData {
  message: GatewayMessageUpdateDispatchData;
  urls: string[];
  guildId: string;
  guildOnly: boolean;
}

type UrlsRunnerResult = OkRunnerResult<Runners.urls, ApiPostFiltersUrlsResult>;

type RunnerResult = NotOkRunnerResult | UrlsRunnerResult;

@singleton()
export class Gateway {
  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger,
    @inject(kRest) public readonly discord: DiscordIRouter,
    public readonly urls: UrlsRunner
  ) {}

  private async runUrls({ message, urls, guildId, guildOnly }: UrlsRunnerData): Promise<NotOkRunnerResult | UrlsRunnerResult> {
    try {
      const hits = await this.urls.run(urls, guildId, guildOnly);
      if (hits.length) {
        await this.discord.channels![message.channel_id]!.messages![message.id]!.delete({ reason: 'Url filter detection' });
      }

      return { ok: true, actioned: hits.length > 0, data: hits, runner: Runners.urls };
    } catch (e) {
      this.logger.error({ topic: 'URL RUNNER', e }, 'Failed to execute runner urls');
      return { ok: false, runner: Runners.urls };
    }
  }

  private async onMessage(message: GatewayMessageUpdateDispatchData) {
    if (!message.guild_id || !message.content?.length) return;

    const [
      settings = {
        use_global_url_filters: UseGlobalUrlFiltersMode.none
      }
    ] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${message.guild_id}`;

    const promises: Promise<RunnerResult>[] = [];

    if (settings.use_global_url_filters !== UseGlobalUrlFiltersMode.none) {
      const urls = this.urls.precheck(message.content);
      if (urls.length) {
        promises.push(
          this.runUrls({
            message,
            urls,
            guildId: message.guild_id,
            guildOnly: settings.use_global_url_filters === UseGlobalUrlFiltersMode.guildOnly
          })
        );
      }
    }

    const data = await Promise.allSettled(promises);
    this.logger.trace({ topic: 'RUNNERS DONE', data }, 'Done running runners');
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
