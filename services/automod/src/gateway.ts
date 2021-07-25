import { inject, singleton } from 'tsyringe';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { createAmqp, RoutingSubscriber } from '@cordis/brokers';
import { FilesRunner, InvitesRunner, UrlsRunner } from './runners';
import { Rest } from '@cordis/rest';
import { RolesPermsCache } from './RolesPermsCache';
import {
  GatewayDispatchEvents,
  GatewayMessageUpdateDispatchData,
  APIRole,
  APIGuild,
  RESTGetAPIGuildRolesResult,
  Snowflake,
  Routes
} from 'discord-api-types/v9';
import {
  ApiPostGuildsFiltersUrlsResult,
  ApiPostGuildsFiltersFilesResult,
  GuildSettings,
  UseFilterMode,
  DiscordEvents
} from '@automoderator/core';
import {
  DiscordPermissions,
  PermissionsChecker,
  PermissionsCheckerData,
  UserPerms
} from '@automoderator/discord-permissions';
import type { Sql } from 'postgres';
import type { Logger } from 'pino';

enum Runners {
  files,
  urls,
  invites
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

interface InviteRunnerData {
  message: GatewayMessageUpdateDispatchData;
  invites: string[];
}

type FilesRunnerResult = OkRunnerResult<Runners.files, ApiPostGuildsFiltersFilesResult>;
type UrlsRunnerResult = OkRunnerResult<Runners.urls, ApiPostGuildsFiltersUrlsResult>;
type InvitesRunnerResult = OkRunnerResult<Runners.invites, string[]>;

type RunnerResult = NotOkRunnerResult | FilesRunnerResult | InvitesRunnerResult | UrlsRunnerResult;

@singleton()
export class Gateway {
  public readonly ownersCache = new Map<Snowflake, Snowflake>();
  public readonly permsCache = new RolesPermsCache();

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger,
    public readonly checker: PermissionsChecker,
    public readonly discord: Rest,
    public readonly urls: UrlsRunner,
    public readonly files: FilesRunner,
    public readonly invites: InvitesRunner
  ) {
    setInterval(() => this.ownersCache.clear(), 36e5).unref();
  }

  private async runUrls({ message, urls, guildId, guildOnly }: UrlsRunnerData): Promise<NotOkRunnerResult | UrlsRunnerResult> {
    try {
      const hits = await this.urls.run(urls, guildId, guildOnly);
      if (hits.length) {
        await this.discord
          .delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Url filter detection' })
          .catch(() => null);
      }

      return { ok: true, actioned: hits.length > 0, data: hits, runner: Runners.urls };
    } catch (error) {
      this.logger.error({ error }, 'Failed to execute runner urls');
      return { ok: false, runner: Runners.urls };
    }
  }

  private async runFiles({ message, urls }: FilesRunnerData): Promise<NotOkRunnerResult | FilesRunnerResult> {
    try {
      const hits = await this.files.run(urls);
      if (hits.length) {
        await this.discord
          .delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'File filter detection' })
          .catch(() => null);
      }

      return { ok: true, actioned: hits.length > 0, data: hits, runner: Runners.files };
    } catch (error) {
      this.logger.error({ error }, 'Failed to execute runner urls');
      return { ok: false, runner: Runners.files };
    }
  }

  private async runInvites({ message, invites }: InviteRunnerData): Promise<NotOkRunnerResult | InvitesRunnerResult> {
    try {
      const hits = await this.invites.run(invites, message.guild_id!);
      if (hits.length) {
        await this.discord
          .delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Invite filter detection' })
          .catch(() => null);
      }

      return { ok: true, actioned: hits.length > 0, data: hits, runner: Runners.invites };
    } catch (error) {
      this.logger.error({ error }, 'Failed to execute runner invites');
      return { ok: false, runner: Runners.files };
    }
  }

  private async onMessage(message: GatewayMessageUpdateDispatchData) {
    if (!message.guild_id || !message.content?.length) {
      return;
    }

    const [
      settings = {
        use_url_filters: UseFilterMode.none,
        use_file_filters: UseFilterMode.none,
        use_invite_filters: false
      }
    ] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${message.guild_id}`;

    if (message.member) {
      const { member, author } = message;

      if (this.config.devIds.includes(author!.id)) {
        return;
      }

      if (this.ownersCache.has(message.guild_id)) {
        if (this.ownersCache.get(message.guild_id)! === author!.id) {
          return;
        }
      } else {
        const guild = await this.discord.get<APIGuild>(Routes.guild(message.guild_id));
        this.ownersCache.set(guild.id, guild.owner_id);

        if (guild.owner_id === author!.id) {
          return;
        }
      }

      const bitfield = new DiscordPermissions(0n);
      let guildRoles: APIRole[];

      const addPerm = (role: Snowflake) => {
        if (this.permsCache.has(role)) {
          bitfield.add(BigInt(this.permsCache.get(role)!));
          return true;
        }

        return false;
      };

      for (const role of member.roles) {
        if (!addPerm(role)) {
          guildRoles ??= await this.discord.get<RESTGetAPIGuildRolesResult>(Routes.guildRoles(message.guild_id)).catch(() => []);
          this.permsCache.add(...guildRoles.map(role => [role.id, role.permissions] as [`${bigint}`, `${bigint}`]));
          addPerm(role);
        }
      }

      const permissions = bitfield.toJSON() as `${bigint}`;
      const checkerData: PermissionsCheckerData = {
        member: {
          ...member,
          user: author!,
          permissions
        },
        guild_id: message.guild_id
      };

      if (await this.checker.check(checkerData, UserPerms.mod, 'guild_id' in settings ? settings : undefined)) {
        return;
      }
    }

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

    if (settings.use_invite_filters) {
      const invites = this.invites.precheck(message.content);
      if (invites.length) {
        promises.push(this.runInvites({ message, invites }));
      }
    }

    const data = (await Promise.allSettled(promises)).reduce<RunnerResult[]>((acc, promise) => {
      if (promise.status === 'fulfilled') {
        acc.push(promise.value);
      }

      return acc;
    }, []);

    this.logger.trace({ data }, 'Done running runners');

    if (data.length) {
      if (!message.author) {
        return this.logger.warn({ message }, 'Message had no author');
      }

      await this.sql`
        INSERT INTO filter_triggers (guild_id, user_id, count)
        VALUES (${message.guild_id}, ${message.author.id}, next_punishment(${message.guild_id}, ${message.author.id}))
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET count = next_punishment(${message.guild_id}, ${message.author.id})
      `;
    }
  }

  public async init() {
    const { channel } = await createAmqp(this.config.amqpUrl);
    const gateway = new RoutingSubscriber<keyof DiscordEvents, DiscordEvents>(channel);

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
