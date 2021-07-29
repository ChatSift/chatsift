import { inject, singleton } from 'tsyringe';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { createAmqp, PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { FilesRunner, InvitesRunner, UrlsRunner, WordsRunner } from './runners';
import { Rest } from '@automoderator/http-client';
import { Rest as CordisRest } from '@cordis/rest';
import { RolesPermsCache } from './RolesPermsCache';
import { FilterIgnores } from '@automoderator/filter-ignores';
import {
  GatewayDispatchEvents,
  APIMessage,
  APIRole,
  APIGuild,
  RESTGetAPIGuildRolesResult,
  RESTPatchAPIGuildMemberJSONBody,
  Snowflake,
  Routes
} from 'discord-api-types/v9';
import {
  GuildSettings,
  UseFilterMode,
  DiscordEvents,
  FilterIgnore,
  NotOkRunnerResult,
  UrlsRunnerResult,
  Runners,
  FilesRunnerResult,
  InvitesRunnerResult,
  WordsRunnerResult,
  RunnerResult,
  Log,
  LogTypes,
  OkRunnerResult,
  ApiPostGuildsCasesBody,
  CaseAction,
  ApiPostGuildsCasesResult,
  UnmuteRole
} from '@automoderator/core';
import {
  DiscordPermissions,
  PermissionsChecker,
  PermissionsCheckerData,
  UserPerms
} from '@automoderator/discord-permissions';
import type { Sql } from 'postgres';
import type { Logger } from 'pino';

interface FilesRunnerData {
  message: APIMessage;
  urls: string[];
  guildId: string;
  guildOnly: boolean;
}

interface UrlsRunnerData {
  message: APIMessage;
  urls: string[];
  guildId: string;
  guildOnly: boolean;
}

interface InviteRunnerData {
  message: APIMessage;
  invites: string[];
}

export interface WordsRunnerData {
  message: APIMessage;
  settings: Partial<GuildSettings>;
}

@singleton()
export class Gateway {
  public guildLogs!: PubSubPublisher<Log>;

  public readonly ownersCache = new Map<Snowflake, Snowflake>();
  public readonly permsCache = new RolesPermsCache();

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger,
    public readonly rest: Rest,
    public readonly discord: CordisRest,
    public readonly checker: PermissionsChecker,
    public readonly urls: UrlsRunner,
    public readonly files: FilesRunner,
    public readonly invites: InvitesRunner,
    public readonly words: WordsRunner
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

  private async runWords({ message, settings }: WordsRunnerData): Promise<NotOkRunnerResult | WordsRunnerResult> {
    try {
      const hit = await this.words.run(message);
      if (hit) {
        await this.discord
          .delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Words filter detection' })
          .catch(() => null);

        const data: ApiPostGuildsCasesBody = [];
        const unmuteRoles: Snowflake[] = [];

        const caseBase = {
          mod_id: this.config.discordClientId,
          mod_tag: 'AutoModerator#0000',
          reason: `Automated punishment triggered by saying \`${hit.word}\``,
          target_id: message.author.id,
          target_tag: `${message.author.username}#${message.author.discriminator}`,
          created_at: new Date()
        };

        if (hit.flags.has('warn')) {
          data.push({ action: CaseAction.warn, ...caseBase });
        }

        if (hit.flags.has('mute') && settings.mute_role) {
          unmuteRoles.concat([...message.member!.roles]);
          let expiresAt: Date | undefined;

          const guildRoles = new Map(
            await this.discord.get<APIRole[]>(`/guilds/${message.guild_id}/roles`)
              .catch(() => [] as APIRole[])
              .then(
                roles => roles.map(
                  role => [role.id, role]
                )
              )
          );

          const roles = message.member!.roles.filter(r => guildRoles.get(r)!.managed).concat([settings.mute_role]);

          await this.discord.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(message.guild_id!, message.author.id), {
            data: { roles },
            reason: `Automatic punishment triggered by saying \`${hit.word}\``
          });

          if (hit.duration) {
            expiresAt = new Date(Date.now() + (hit.duration * 6e4));
          }

          data.push({ action: CaseAction.mute, expires_at: expiresAt, ...caseBase });
        }

        if (hit.flags.has('ban')) {
          await this.discord.put(Routes.guildBan(message.guild_id!, message.author.id), {
            reason: `Automatic punishment triggered by saying \`${hit.word}\``
          });

          data.push({ action: CaseAction.ban, ...caseBase });
        }

        if (data.length) {
          const cases = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(
            `/guilds/${message.guild_id!}/cases`,
            data
          );

          const muteCase = cases.find(cs => cs.action_type === CaseAction.mute);

          if (muteCase && unmuteRoles.length) {
            const unmuteData = unmuteRoles.map<UnmuteRole>(r => ({ case_id: muteCase.id, role_id: r }));
            await this.sql`INSERT INTO unmute_roles ${this.sql(unmuteData)}`;
          }
        }
      }

      return {
        ok: true,
        actioned: Boolean(hit),
        data: hit
          ? { ...hit, flags: hit.flags.toJSON() as `${bigint}` }
          : null,
        runner: Runners.words
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to execute runner words');
      return { ok: false, runner: Runners.words };
    }
  }

  private async onMessage(message: APIMessage) {
    if (!message.guild_id || !message.content.length || message.author.bot || !message.member) {
      return;
    }

    const [
      settings = {
        use_url_filters: UseFilterMode.none,
        use_file_filters: false,
        use_invite_filters: false
      }
    ] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${message.guild_id}`;

    if (this.config.nodeEnv === 'prod') {
      const { member, author } = message;

      if (this.config.devIds.includes(author.id)) {
        return;
      }

      if (this.ownersCache.has(message.guild_id)) {
        if (this.ownersCache.get(message.guild_id)! === author.id) {
          return;
        }
      } else {
        const guild = await this.discord.get<APIGuild>(Routes.guild(message.guild_id));
        this.ownersCache.set(guild.id, guild.owner_id);

        if (guild.owner_id === author.id) {
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
          user: author,
          permissions
        },
        guild_id: message.guild_id
      };

      if (await this.checker.check(checkerData, UserPerms.mod, 'guild_id' in settings ? settings : undefined)) {
        return;
      }
    }

    const [ignoreData] = await this.sql<[FilterIgnore?]>`
      SELECT * FROM filter_ignores
      WHERE channel_id = ${message.channel_id}
    `;

    const ignores = new FilterIgnores(BigInt(ignoreData?.value ?? '0'));

    const promises: Promise<RunnerResult>[] = [];

    if (settings.use_url_filters !== UseFilterMode.none && !ignores.has('urls')) {
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

    if (settings.use_file_filters && !ignores.has('files')) {
      const urls = this.files.precheck([
        ...new Set([
          ...this.urls.precheck(message.content).map(url => url.startsWith('http') ? url : `https://${url}`),
          ...message.embeds.reduce<string[]>((acc, embed) => {
            if (embed.url) {
              acc.push(embed.url);
            }

            return acc;
          }, []),
          ...message.attachments.map(attachment => attachment.url)
        ])
      ]);

      if (urls.length) {
        promises.push(
          this.runFiles({
            message,
            urls,
            guildId: message.guild_id,
            guildOnly: settings.use_url_filters === UseFilterMode.guildOnly
          })
        );
      }
    }

    if (settings.use_invite_filters && !ignores.has('invites')) {
      const invites = this.invites.precheck(message.content);
      if (invites.length) {
        promises.push(this.runInvites({ message, invites }));
      }
    }

    if (!ignores.has('words')) {
      promises.push(this.runWords({ message, settings }));
    }

    const data = (await Promise.allSettled(promises)).reduce<RunnerResult[]>((acc, promise) => {
      if (promise.status === 'fulfilled') {
        if (promise.value.ok && promise.value.actioned) {
          acc.push(promise.value);
        }
      }

      return acc;
    }, []);

    this.logger.debug({ data, guild: message.guild_id }, 'Done running automod');

    if (data.length) {
      await this.sql`
        INSERT INTO filter_triggers (guild_id, user_id, count)
        VALUES (${message.guild_id}, ${message.author.id}, next_punishment(${message.guild_id}, ${message.author.id}))
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET count = next_punishment(${message.guild_id}, ${message.author.id})
      `;

      this.guildLogs.publish({
        data: {
          message,
          triggers: data as OkRunnerResult<any, any>[]
        },
        type: LogTypes.filterTrigger
      });
    }
  }

  public async init() {
    const { channel } = await createAmqp(this.config.amqpUrl);
    const gateway = new RoutingSubscriber<keyof DiscordEvents, DiscordEvents>(channel);
    const logs = new PubSubPublisher(channel);

    await logs.init({ name: 'guild_logs', fanout: false });

    this.guildLogs = logs;

    gateway
      .on(GatewayDispatchEvents.MessageCreate, message => void this.onMessage(message))
      .on(GatewayDispatchEvents.MessageUpdate, async message => {
        const fullMessage = await this.discord.get<APIMessage>(Routes.channelMessage(message.channel_id, message.id)).catch(() => null);
        if (fullMessage) {
          return this.onMessage(fullMessage);
        }
      });

    await gateway.init({
      name: 'gateway',
      keys: [GatewayDispatchEvents.MessageCreate, GatewayDispatchEvents.MessageUpdate],
      queue: 'automod'
    });

    return gateway;
  }
}
