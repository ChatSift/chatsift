import { MessageCache } from '@automoderator/cache';
import {
  AntispamRunnerResult,
  ApiGetGuildsSettingsResult,
  ApiPostGuildsCasesBody,
  ApiPostGuildsCasesResult,
  AutomodPunishment,
  AutomodTrigger,
  CaseAction,
  CaseData,
  DiscordEvents,
  FilesRunnerResult,
  FilterIgnore,
  GuildSettings,
  InvitesRunnerResult,
  Log,
  LogTypes,
  MentionsRunnerResult,
  NotOkRunnerResult,
  OkRunnerResult,
  RunnerResult,
  Runners,
  UrlsRunnerResult,
  WordsRunnerResult
} from '@automoderator/core';
import {
  DiscordPermissions,
  PermissionsChecker,
  PermissionsCheckerData,
  UserPerms
} from '@automoderator/discord-permissions';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { Rest } from '@automoderator/http-client';
import { reportMessage } from '@automoderator/util';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { createAmqp, PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { Store } from '@cordis/store';
import { Rest as CordisRest } from '@cordis/rest';
import {
  APIChannel,
  APIUser,
  APIGuild,
  APIMessage,
  APIRole,
  GatewayDispatchEvents,
  ChannelType,
  RESTGetAPIGuildRolesResult,
  RESTPostAPIChannelMessagesBulkDeleteJSONBody,
  Routes,
  Snowflake
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';
import { AntispamRunner, FilesRunner, InvitesRunner, UrlsRunner, WordsRunner } from './runners';
import { getCreationData } from '@cordis/util';
import { MentionsRunner } from './runners/mentions';

interface FilesRunnerData {
  message: APIMessage;
  urls: string[];
}

interface UrlsRunnerData {
  message: APIMessage;
  urls: string[];
}

interface InviteRunnerData {
  message: APIMessage;
  invites: string[];
}

interface WordsRunnerData {
  message: APIMessage;
  settings: Partial<GuildSettings>;
}

type AntispamRunnerData = WordsRunnerData;

@singleton()
export class Gateway {
  public guildLogs!: PubSubPublisher<Log>;

  public readonly ownersCache = new Store<Snowflake>({ emptyEvery: 36e5 });
  public readonly permsCache = new Store<Snowflake>({ emptyEvery: 15e3 });
  public readonly channelParentCache = new Store<Snowflake | null>({ emptyEvery: 15e3 });

  public readonly fetchingChannels = new Map<Snowflake, Promise<void>>();

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger,
    public readonly messagesCache: MessageCache,
    public readonly rest: Rest,
    public readonly discord: CordisRest,
    public readonly checker: PermissionsChecker,
    public readonly urls: UrlsRunner,
    public readonly files: FilesRunner,
    public readonly invites: InvitesRunner,
    public readonly words: WordsRunner,
    public readonly antispam: AntispamRunner,
    public readonly mentions: MentionsRunner
  ) {}

  private async runUrls({ message, urls }: UrlsRunnerData): Promise<NotOkRunnerResult | UrlsRunnerResult> {
    try {
      const hits = await this.urls.run(urls);
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
      const hits = await this.words.run(message);
      if (hits.length) {
        if (!hits.every(hit => hit.flags.has('report'))) {
          await this.discord
            .delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Words filter detection' })
            .catch(() => null);
        }

        let warned = false;
        let muted = false;
        let banned = false;
        let reported = false;

        for (const hit of hits) {
          const data: ApiPostGuildsCasesBody = [];
          const unmuteRoles: Snowflake[] = [];

          const reason = `automated punishment triggered for saying ${hit.word}`;

          const caseBase = {
            mod_id: this.config.discordClientId,
            mod_tag: 'AutoModerator#0000',
            reason,
            target_id: message.author.id,
            target_tag: `${message.author.username}#${message.author.discriminator}`,
            created_at: new Date(),
            execute: true
          };

          if (hit.flags.has('warn') && !warned && !banned) {
            warned = true;
            data.push({ action: CaseAction.warn, ...caseBase });
          }

          if (hit.flags.has('mute') && settings.mute_role && !muted && !banned) {
            muted = true;
            unmuteRoles.concat([...message.member!.roles]);

            let expiresAt: Date | undefined;
            if (hit.duration) {
              expiresAt = new Date(Date.now() + (hit.duration * 6e4));
            }

            data.push({ action: CaseAction.mute, expires_at: expiresAt, ...caseBase });
          }

          if (hit.flags.has('ban') && !banned) {
            banned = true;
            data.push({ action: CaseAction.ban, ...caseBase });
          }

          if (hit.flags.has('report') && !reported) {
            reported = true;

            const me = await this.discord.get<APIUser>(Routes.user(this.config.discordClientId));
            const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${message.guild_id}/settings`);

            await reportMessage(me, message, settings);
          }

          if (data.length) {
            const cases = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(
              `/guilds/${message.guild_id!}/cases`,
              data
            );

            this.guildLogs.publish({
              data: cases,
              type: LogTypes.modAction
            });
          }
        }
      }

      return {
        ok: true,
        actioned: hits.length > 0,
        data: hits.map(hit => ({ ...hit, flags: hit.flags.toJSON() as `${bigint}` })),
        runner: Runners.words
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to execute runner words');
      return { ok: false, runner: Runners.words };
    }
  }

  private async runAntispam({ message, settings }: AntispamRunnerData): Promise<NotOkRunnerResult | AntispamRunnerResult> {
    try {
      const hits = await this.antispam.run(message, settings.antispam_amount!, settings.antispam_time!);
      const messages = await Promise.all(hits.map(hit => this.messagesCache.get(hit)));

      if (messages.length) {
        const groupedMessages = messages.reduce<Record<string, string[]>>((acc, m) => {
          if (m) {
            (acc[m.channel_id] ??= []).push(m.id);
          }

          return acc;
        }, {});

        for (const [channel, messages] of Object.entries(groupedMessages)) {
          if (messages.length === 1) {
            await this.discord
              .delete(Routes.channelMessage(channel, messages[0]!), { reason: 'Antispam trigger' })
              .catch(() => null);
          } else {
            await this.discord.post<never, RESTPostAPIChannelMessagesBulkDeleteJSONBody>(
              Routes.channelBulkDelete(channel), {
                data: {
                  messages
                },
                reason: 'Antispam trigger'
              }
            );
          }
        }
      }

      return {
        ok: true,
        actioned: hits.length > 0,
        data: {
          messages: messages.filter((m): m is APIMessage => Boolean(m)),
          amount: hits.length,
          time: hits.length > 0
            ? getCreationData(hits[hits.length - 1]!).createdTimestamp - getCreationData(hits[0]!).createdTimestamp
            : 0
        },
        runner: Runners.antispam
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to execute runner antispam');
      return { ok: false, runner: Runners.antispam };
    }
  }

  private async runMentions({ message, settings }: AntispamRunnerData): Promise<NotOkRunnerResult | MentionsRunnerResult> {
    try {
      const hits = await this.mentions.run(message, settings.mention_amount, settings.mention_time, settings.mention_limit);
      const messages = await Promise.all(hits.map(hit => this.messagesCache.get(hit)));

      if (messages.length) {
        const groupedMessages = messages.reduce<Record<string, string[]>>((acc, m) => {
          if (m) {
            (acc[m.channel_id] ??= []).push(m.id);
          }

          return acc;
        }, {});

        for (const [channel, messages] of Object.entries(groupedMessages)) {
          if (messages.length === 1) {
            await this.discord
              .delete(Routes.channelMessage(channel, messages[0]!), { reason: 'Anti mention spam trigger' })
              .catch(() => null);
          } else {
            await this.discord.post<never, RESTPostAPIChannelMessagesBulkDeleteJSONBody>(
              Routes.channelBulkDelete(channel), {
                data: {
                  messages
                },
                reason: 'Anti mention spam trigger'
              }
            );
          }
        }
      }

      return {
        ok: true,
        actioned: hits.length > 0,
        data: hits.length > 1
          ? {
            messages: messages.filter((m): m is APIMessage => Boolean(m)),
            amount: hits.length,
            time: getCreationData(hits[hits.length - 1]!).createdTimestamp - getCreationData(hits[0]!).createdTimestamp
          }
          : {
            message: messages[0]!,
            amount: this.mentions.mentionsFromMessage(messages[0]!.content).length
          },
        runner: Runners.mentions
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to execute runner antispam');
      return { ok: false, runner: Runners.mentions };
    }
  }

  private async getChannelParent(guildId: Snowflake, channelId: Snowflake): Promise<Snowflake | null> {
    if (!this.channelParentCache.has(channelId)) {
      if (this.fetchingChannels.has(guildId)) {
        await this.fetchingChannels.get(guildId);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        const promise = new Promise<void>(async resolve => {
          const channels = await this.discord.get<APIChannel[]>(Routes.guildChannels(guildId)).catch(() => []);
          for (const channel of channels) {
            if (channel.type === ChannelType.GuildCategory) {
              continue;
            }

            this.channelParentCache.set(channel.id, channel.parent_id ?? null);
          }

          resolve();
        });

        this.fetchingChannels.set(guildId, promise);

        await promise;
        this.fetchingChannels.delete(guildId);
      }
    }

    return this.channelParentCache.get(channelId) ?? null;
  }

  private async onMessage(message: APIMessage) {
    if (!message.guild_id || !message.content.length || message.author.bot || !message.member || message.webhook_id) {
      return;
    }

    const [
      settings = {
        use_url_filters: false,
        use_file_filters: false,
        use_invite_filters: false,
        antispam_amount: null,
        antispam_time: null,
        mention_limit: null,
        mention_amount: null,
        mention_time: null
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
          for (const role of guildRoles) {
            this.permsCache.set(role.id, role.permissions);
          }

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

    const parentId = await this.getChannelParent(message.guild_id, message.channel_id);
    if (parentId) {
      const [parentIgnoreData] = await this.sql<[FilterIgnore?]>`
        SELECT * FROM filter_ignores
        WHERE channel_id = ${parentId}
      `;

      ignores.add(BigInt(parentIgnoreData?.value ?? 0));
    }

    const promises: Promise<RunnerResult>[] = [];

    if (settings.use_url_filters && !ignores.has('urls')) {
      const urls = this.urls.precheck(message.content);
      if (urls.length) {
        promises.push(this.runUrls({ message, urls }));
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
        promises.push(this.runFiles({ message, urls }));
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

    if (settings.antispam_amount && settings.antispam_time) {
      promises.push(this.runAntispam({ message, settings }));
    }

    if (
      ((settings.mention_amount && settings.mention_time) || settings.mention_limit) &&
      this.mentions.precheck(message.content)
    ) {
      promises.push(this.runMentions({ message, settings }));
    }

    const data = (await Promise.allSettled(promises)).reduce<RunnerResult[]>((acc, promise) => {
      if (promise.status === 'fulfilled') {
        if (promise.value.ok && promise.value.actioned) {
          acc.push(promise.value);
        }
      }

      return acc;
    }, []);

    this.logger.trace({ data, guild: message.guild_id }, 'Done running automod');

    if (data.length) {
      await this.sql`
        INSERT INTO filter_triggers (guild_id, user_id, count)
        VALUES (${message.guild_id}, ${message.author.id}, next_automod_trigger(${message.guild_id}, ${message.author.id}))
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET count = next_automod_trigger(${message.guild_id}, ${message.author.id})
      `;

      if (data.find(result => result.runner === Runners.antispam)) {
        const [trigger] = await this.sql<[AutomodTrigger]>`
          INSERT INTO automod_triggers (guild_id, user_id, count)
          VALUES (${message.guild_id}, ${message.author.id}, next_automod_trigger(${message.guild_id}, ${message.author.id}))
          ON CONFLICT (guild_id, user_id)
            DO UPDATE SET count = next_automod_trigger(${message.guild_id}, ${message.author.id})
          RETURNING *
        `;

        const [punishment] = await this.sql<[AutomodPunishment?]>`
          SELECT * FROM automod_punishments
          WHERE guild_id = ${message.guild_id}
            AND triggers = ${trigger.count}
        `;

        if (punishment) {
          const ACTIONS = [
            CaseAction.warn,
            CaseAction.mute,
            CaseAction.kick,
            CaseAction.ban
          ] as const;

          const caseData: CaseData = {
            mod_id: this.config.discordClientId,
            mod_tag: 'AutoModerator#0000',
            target_id: message.author.id,
            target_tag: `${message.author.username}#${message.author.discriminator}`,
            reason: 'spamming',
            created_at: new Date(),
            execute: true,
            action: ACTIONS[punishment.action_type]
          };

          if (caseData.action === CaseAction.mute) {
            caseData.expires_at = punishment.duration ? new Date(punishment.duration * 6e4) : null;
          } else if (caseData.action === CaseAction.ban) {
            caseData.expires_at = punishment.duration ? new Date(punishment.duration * 6e4) : null;
            caseData.delete_message_days = 1;
          }

          const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(
            `/guilds/${message.guild_id}/cases`, [
              caseData
            ]
          );

          this.guildLogs.publish({
            data: cs!,
            type: LogTypes.modAction
          });
        }
      }

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
        const fullMessage = await this.messagesCache.get(message.id) ??
          await this.discord.get<APIMessage>(Routes.channelMessage(message.channel_id, message.id))
            .then(message => {
              void this.messagesCache.add(message);
              return message;
            })
            .catch(() => null);

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
