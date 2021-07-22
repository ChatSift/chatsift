import { inject, singleton } from 'tsyringe';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { createAmqp, RoutingClient } from '@cordis/brokers';
import { GatewayDispatchEvents, GatewayMessageUpdateDispatchData, Routes } from 'discord-api-types/v9';
import { FilesRunner, UrlsRunner } from './runners';
import { Rest } from '@cordis/rest';
import {
  ApiPostGuildsFiltersUrlsResult,
  ApiPostGuildsFiltersFilesResult,
  GuildSettings,
  UseFilterMode,
  DiscordEvents
} from '@automoderator/core';
import type { Sql } from 'postgres';
import type { Logger } from 'pino';

enum Runners {
  files,
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

interface FilesRunnerData {
  message: GatewayMessageUpdateDispatchData;
  urls: string[];
}

interface UrlsRunnerData {
  message: GatewayMessageUpdateDispatchData;
  urls: string[];
  guildId: string;
  guildOnly: boolean;
}

type FilesRunnerResult = OkRunnerResult<Runners.files, ApiPostGuildsFiltersFilesResult>;
type UrlsRunnerResult = OkRunnerResult<Runners.urls, ApiPostGuildsFiltersUrlsResult>;

type RunnerResult = NotOkRunnerResult | FilesRunnerResult | UrlsRunnerResult;

@singleton()
export class Gateway {
  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger,
    public readonly discord: Rest,
    public readonly urls: UrlsRunner,
    public readonly files: FilesRunner
  ) {}

  private async runUrls({ message, urls, guildId, guildOnly }: UrlsRunnerData): Promise<NotOkRunnerResult | UrlsRunnerResult> {
    try {
      const hits = await this.urls.run(urls, guildId, guildOnly);
      if (hits.length) {
        await this.discord.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Url filter detection' });
      }

      return { ok: true, actioned: hits.length > 0, data: hits, runner: Runners.urls };
    } catch (e) {
      this.logger.error({ e }, 'Failed to execute runner urls');
      return { ok: false, runner: Runners.urls };
    }
  }

  private async runFiles({ message, urls }: FilesRunnerData): Promise<NotOkRunnerResult | FilesRunnerResult> {
    try {
      const hits = await this.files.run(urls);
      if (hits.length) {
        await this.discord.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'File filter detection' });
      }

      return { ok: true, actioned: hits.length > 0, data: hits, runner: Runners.files };
    } catch (e) {
      this.logger.error({ e }, 'Failed to execute runner urls');
      return { ok: false, runner: Runners.files };
    }
  }

  private async onMessage(message: GatewayMessageUpdateDispatchData) {
    if (!message.guild_id || !message.content?.length) return;

    const [
      settings = {
        use_url_filters: UseFilterMode.none,
        use_file_filters: UseFilterMode.none
      }
    ] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${message.guild_id}`;

    const promises: Promise<RunnerResult>[] = [];

    if (settings.use_url_filters !== UseFilterMode.none) {
      const urls = this.urls.precheck(message.content);
      if (urls.length) {
        promises.push(
          this.runUrls({
            message,
            urls,
            guildId: message.guild_id,
            guildOnly: settings.use_url_filters === UseFilterMode.guildOnly
          })
        );
      }
    }

    if (settings.use_file_filters !== UseFilterMode.none) {
      const urls = this.files.precheck([
        ...new Set([
          ...this.urls.precheck(message.content).map(url => url.startsWith('http') ? url : `https://${url}`),
          ...message.embeds?.reduce<string[]>((acc, embed) => {
            if (embed.url) {
              acc.push(embed.url);
            }

            return acc;
          }, []) ?? [],
          ...message.attachments?.map(attachment => attachment.url) ?? []
        ])
      ]);

      if (urls.length) {
        promises.push(this.runFiles({ message, urls }));
      }
    }

    const data = await Promise.allSettled(promises);
    this.logger.trace({ data }, 'Done running runners');
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
