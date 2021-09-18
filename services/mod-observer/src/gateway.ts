import { MessageCache, GuildMemberCache, CachedGuildMember } from '@automoderator/cache';
import {
  ApiGetGuildLogIgnoresResult,
  ApiPostGuildsCasesBody,
  ApiPostGuildsCasesResult,
  Case,
  CaseAction,
  DiscordEvents,
  GuildSettings,
  Log,
  LogTypes,
  ServerLogs,
  ServerLogType
} from '@automoderator/core';
import { DiscordPermissions } from '@automoderator/discord-permissions';
import { Rest } from '@automoderator/http-client';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { createAmqp, PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { Store } from '@cordis/store';
import { Rest as CordisRest } from '@cordis/rest';
import { getCreationData } from '@cordis/util';
import {
  APIChannel,
  APIMessage,
  APIGuildMember,
  APIRole,
  APIUser,
  AuditLogEvent,
  GatewayDispatchEvents,
  GatewayGuildBanModifyDispatchData,
  GatewayGuildMemberAddDispatchData,
  GatewayGuildMemberRemoveDispatchData,
  GatewayGuildMemberUpdateDispatchData,
  RESTGetAPIAuditLogQuery,
  RESTGetAPIAuditLogResult,
  RESTPatchAPIGuildMemberJSONBody,
  ChannelType,
  Routes,
  Snowflake
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class Gateway {
  public readonly guildPermsCache = new Store<DiscordPermissions>({ emptyEvery: 15e3 });
  public readonly channelParentCache = new Store<Snowflake | null>({ emptyEvery: 12e4 });

  public guildLogs!: PubSubPublisher<Log>;

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger,
    public readonly guildMembersCache: GuildMemberCache,
    public readonly messageCache: MessageCache,
    public readonly rest: Rest,
    public readonly discord: CordisRest
  ) {}

  private async getChannelParent(guildId: Snowflake, channelId: Snowflake): Promise<Snowflake | null> {
    if (!this.channelParentCache.has(channelId)) {
      const channels = await this.discord.get<APIChannel[]>(Routes.guildChannels(guildId));
      for (const channel of channels) {
        if (channel.type === ChannelType.GuildCategory) {
          continue;
        }

        this.channelParentCache.set(channel.id, channel.parent_id ?? null);
      }
    }

    return this.channelParentCache.get(channelId) ?? null;
  }

  private async getPerms(guildId: Snowflake): Promise<DiscordPermissions> {
    if (this.guildPermsCache.has(guildId)) {
      return this.guildPermsCache.get(guildId)!;
    }

    const guildMe = await this.discord.get<APIGuildMember>(Routes.guildMember(guildId, this.config.discordClientId)).catch(() => null);
    const roles = await this.discord.get<APIRole[]>(Routes.guildRoles(guildId))
      .then(
        roles => new Map(
          roles.map(role => [role.id, role])
        )
      )
      .catch(() => null);

    if (!guildMe || !roles) {
      this.logger.warn('Something went wrong getting the guild member object or the guild roles - returning no perms');
      return new DiscordPermissions(0n);
    }

    const perms = guildMe.roles.reduce<DiscordPermissions>(
      (acc, role) => acc.add(BigInt(roles.get(role)!.permissions)),
      new DiscordPermissions(0n)
    );

    this.guildPermsCache.set(guildId, perms);

    return perms;
  }

  private async hasAuditLog(guildId: Snowflake): Promise<boolean> {
    const perms = await this.getPerms(guildId);
    return perms.has('viewAuditLog');
  }

  private async handleGuildBanAdd(data: GatewayGuildBanModifyDispatchData) {
    const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${data.guild_id}`;

    if (!settings?.mod_action_log_channel) {
      return null;
    }

    const [existingCs] = await this.sql<[Case?]>`
      SELECT * FROM cases
      WHERE guild_id = ${data.guild_id}
        AND target_id = ${data.user.id}
        AND action_type = ${CaseAction.ban}
      ORDER BY created_at DESC
    `;

    if (existingCs && (Date.now() - existingCs.created_at.getTime()) >= 3e4) {
      return null;
    }

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/guilds/${data.guild_id}/cases`, [{
      action: CaseAction.ban,
      target_id: data.user.id,
      target_tag: `${data.user.username}#${data.user.discriminator}`,
      created_at: new Date()
    }]);

    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }

  private async handleGuildBanRemove(data: GatewayGuildBanModifyDispatchData) {
    const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${data.guild_id}`;

    if (!settings?.mod_action_log_channel) {
      return null;
    }

    const [existingCs] = await this.sql<[Case?]>`
      SELECT * FROM cases
      WHERE guild_id = ${data.guild_id}
        AND target_id = ${data.user.id}
        AND action_type = ${CaseAction.unban}
      ORDER BY created_at DESC
    `;

    if (existingCs && (Date.now() - existingCs.created_at.getTime()) >= 3e4) {
      return null;
    }

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/guilds/${data.guild_id}/cases`, [{
      action: CaseAction.unban,
      target_id: data.user.id,
      target_tag: `${data.user.username}#${data.user.discriminator}`,
      created_at: new Date()
    }]);

    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }

  private async handleGuildMemberRemove(data: GatewayGuildMemberRemoveDispatchData) {
    const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${data.guild_id}`;

    if (!settings?.mod_action_log_channel || !await this.hasAuditLog(data.guild_id)) {
      return null;
    }

    const fetchedLog = await this.discord.get<RESTGetAPIAuditLogResult, RESTGetAPIAuditLogQuery>(Routes.guildAuditLog(data.guild_id), {
      query: {
        action_type: AuditLogEvent.MemberKick,
        limit: 1
      }
    });

    const [entry] = fetchedLog.audit_log_entries;
    if (
      !entry ||
      entry.target_id !== data.user.id ||
      (Date.now() - getCreationData(entry.id).createdAt.getTime()) >= 3e4
    ) {
      return null;
    }

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/guilds/${data.guild_id}/cases`, [{
      action: CaseAction.kick,
      target_id: data.user.id,
      target_tag: `${data.user.username}#${data.user.discriminator}`,
      created_at: new Date()
    }]);

    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }

  private async handleExistingMute(data: GatewayGuildMemberAddDispatchData) {
    const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${data.guild_id}`;

    const [existingMuteCase] = await this.sql<[Case?]>`
      SELECT * FROM cases
      WHERE target_id = ${data.user!.id}
        AND action_type = ${CaseAction.mute}
        AND guild_id = ${data.guild_id}
        AND processed = false
    `;

    if (!settings?.mute_role || !existingMuteCase) {
      return null;
    }

    await this.discord.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(data.guild_id, data.user!.id), {
      data: { roles: [settings.mute_role] },
      reason: 'User is muted but rejoined the server'
    }).catch(() => null);
  }

  private async handleJoinAge(data: GatewayGuildMemberAddDispatchData) {
    const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${data.guild_id}`;

    if (settings?.min_join_age == null || data.user!.bot) {
      return null;
    }

    if (Date.now() - getCreationData(data.user!.id).createdAt.getTime() >= settings.min_join_age) {
      return null;
    }

    await this.discord.delete(Routes.guildMember(data.guild_id, data.user!.id), {
      reason: 'Join age violation'
    }).catch(() => null);
  }

  private async handleBlankAvatar(data: GatewayGuildMemberAddDispatchData) {
    const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${data.guild_id}`;

    if (!settings?.no_blank_avatar || data.user!.bot) {
      return null;
    }

    if (data.user!.avatar) {
      return null;
    }

    await this.discord.delete(Routes.guildMember(data.guild_id, data.user!.id), {
      reason: 'Blank avatar violation'
    }).catch(() => null);
  }

  private handleGuildMemberUpdate(o: CachedGuildMember, n: GatewayGuildMemberUpdateDispatchData) {
    if (n.user.bot) {
      return;
    }

    const logs: ServerLogs[] = [];

    if (o.nick !== n.nick) {
      logs.push({
        type: ServerLogType.nickUpdate,
        data: {
          o: o.nick ?? null,
          n: n.nick ?? null
        }
      });
    }

    if (o.user.username !== n.user.username) {
      logs.push({
        type: ServerLogType.usernameUpdate,
        data: {
          o: o.user.username,
          n: n.user.username
        }
      });
    }

    if (logs.length) {
      this.guildLogs.publish({
        type: LogTypes.server,
        data: {
          guild: n.guild_id,
          user: n.user,
          logs
        }
      });
    }
  }

  private async handleMessageDelete(message: APIMessage) {
    if (!message.guild_id || message.author.bot || message.webhook_id) {
      return;
    }

    const parent = await this.getChannelParent(message.guild_id, message.channel_id);
    const ignores = await this.rest.get<ApiGetGuildLogIgnoresResult>(`/guilds/${message.guild_id}/settings/log-ignores`);
    if (ignores.find(ignore => ignore.channel_id === message.channel_id || ignore.channel_id === parent)) {
      return;
    }

    let mod: APIUser | undefined;
    if (await this.hasAuditLog(message.guild_id)) {
      const fetchedLog = await this.discord.get<RESTGetAPIAuditLogResult, RESTGetAPIAuditLogQuery>(Routes.guildAuditLog(message.guild_id), {
        query: {
          action_type: AuditLogEvent.MessageDelete,
          limit: 1
        }
      });

      const [entry] = fetchedLog.audit_log_entries;
      if (
        entry?.user_id &&
        entry.target_id === message.id &&
        (Date.now() - getCreationData(entry.id).createdAt.getTime()) < 3e4
      ) {
        mod = await this.discord.get<APIUser>(Routes.user(entry.user_id)).catch(() => undefined);
      }
    }

    this.guildLogs.publish({
      type: LogTypes.server,
      data: {
        guild: message.guild_id,
        user: message.author,
        logs: [{
          type: ServerLogType.messageDelete,
          data: {
            message,
            mod,
            hadAttachments: Boolean(message.attachments.length || message.embeds.length)
          }
        }]
      }
    });
  }

  private async handleMessageUpdate(o: APIMessage, n: APIMessage) {
    if (!n.guild_id || n.author.bot || n.webhook_id) {
      return;
    }

    const parent = await this.getChannelParent(n.guild_id, n.channel_id);
    const ignores = await this.rest.get<ApiGetGuildLogIgnoresResult>(`/guilds/${n.guild_id}/settings/log-ignores`);
    if (ignores.find(ignore => ignore.channel_id === n.channel_id || ignore.channel_id === parent)) {
      return;
    }

    if (o.content !== n.content) {
      this.guildLogs.publish({
        type: LogTypes.server,
        data: {
          guild: n.guild_id,
          user: n.author,
          logs: [{
            type: ServerLogType.messageEdit,
            data: {
              message: n,
              o: o.content || '`none`',
              n: n.content || '`none`'
            }
          }]
        }
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
      .on(GatewayDispatchEvents.GuildBanAdd, data => void this.handleGuildBanAdd(data))
      .on(GatewayDispatchEvents.GuildBanRemove, data => void this.handleGuildBanRemove(data))
      .on(GatewayDispatchEvents.GuildMemberRemove, data => void this.handleGuildMemberRemove(data))
      .on(GatewayDispatchEvents.GuildMemberAdd, data => {
        void this.handleExistingMute(data);
        void this.handleJoinAge(data);
        void this.handleBlankAvatar(data);
      })
      .on(GatewayDispatchEvents.GuildMemberUpdate, async data => {
        const cachedOld = await this.guildMembersCache.get(data.guild_id, data.user.id);

        if (cachedOld) {
          const n = { ...cachedOld, ...data };

          void this.guildMembersCache
            // @ts-expect-error - Common discord-api-types missmatch
            .add(n)
            .catch(error => this.logger.warn({ error, guild: data.guild_id }, 'Failed to update message cache'));

          return this.handleGuildMemberUpdate(cachedOld, n);
        }
      })
      .on(GatewayDispatchEvents.MessageDelete, async data => {
        const cachedOld = await this.messageCache.get(data.id);

        if (cachedOld) {
          void this.messageCache.delete(data.id);
          return this.handleMessageDelete(cachedOld);
        }
      })
      .on(GatewayDispatchEvents.MessageUpdate, async data => {
        const cachedOld = await this.messageCache.get(data.id);

        if (cachedOld) {
          const n = { ...cachedOld, ...data };

          void this.messageCache
            .add(n)
            .catch(error => this.logger.warn({ error, guild: data.guild_id }, 'Failed to update message cache'));

          return this.handleMessageUpdate(cachedOld, n);
        }
      });

    await gateway.init({
      name: 'gateway',
      keys: [
        GatewayDispatchEvents.GuildBanAdd,
        GatewayDispatchEvents.GuildBanRemove,
        GatewayDispatchEvents.GuildMemberRemove,
        GatewayDispatchEvents.GuildMemberAdd,
        GatewayDispatchEvents.GuildMemberUpdate,
        GatewayDispatchEvents.MessageDelete,
        GatewayDispatchEvents.MessageUpdate
      ],
      queue: 'mod_observer'
    });

    return gateway;
  }
}
