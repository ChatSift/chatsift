import { BanwordFlags } from '@automoderator/banword-flags';
import {
  Case,
  CaseAction,
  FilterTriggerLog,
  GroupedServerLogs,
  GuildSettings,
  Log,
  LogTypes,
  MaliciousFileCategory,
  MaliciousUrlCategory,
  ModActionLog,
  ms,
  NotOkRunnerResult,
  RunnerResult,
  Runners,
  ServerLog,
  ServerLogType,
  WarnCase,
  WarnPunishmentAction,
  WebhookToken
} from '@automoderator/core';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { addFields, ellipsis, EMBED_DESCRIPTION_LIMIT, EMBED_FOOTER_TEXT_LIMIT, makeCaseEmbed } from '@automoderator/util';
import { createAmqp, PubSubSubscriber } from '@cordis/brokers';
import { HTTPError as CordisHTTPError, Rest } from '@cordis/rest';
import { getCreationData, makeDiscordCdnUrl } from '@cordis/util';
import {
  APIEmbed,
  APIMessage,
  APIUser,
  APIWebhook,
  RESTPatchAPIWebhookWithTokenMessageJSONBody,
  RESTPostAPIChannelWebhookJSONBody,
  RESTPostAPIChannelWebhookResult,
  RESTPostAPIWebhookWithTokenJSONBody,
  RESTPostAPIWebhookWithTokenWaitResult,
  RouteBases,
  Routes, Snowflake
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class Handler {
  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kLogger) public readonly logger: Logger,
    @inject(kSql) public readonly sql: Sql<{}>,
    public readonly rest: Rest
  ) {}

  private _populateEmbedWithWarnPunishment(embed: APIEmbed, cs: WarnCase): APIEmbed {
    if (!cs.extra) {
      return embed;
    }

    let value: string | undefined;

    switch (cs.extra.triggered) {
      case WarnPunishmentAction.kick: {
        value = 'Kick';
        break;
      }

      case WarnPunishmentAction.mute:
      case WarnPunishmentAction.ban: {
        const action = cs.extra.triggered === WarnPunishmentAction.mute ? 'Mute' : 'Ban';

        if (!cs.extra.duration) {
          value = `Permanent ${action.toLowerCase()}`;
        } else if (cs.extra.extendedBy) {
          value = `${action} extended by ${ms(cs.extra.extendedBy, true)} - ` +
            `meaning it will now expire in ${ms(cs.extra.extendedBy + cs.extra.duration, true)}`;
        } else {
          value = `${action} that will last for ${ms(cs.extra.duration, true)}`;
        }

        break;
      }

      default: {
        this.logger.warn({ cs }, 'Recieved unrecognized warn case trigger');
        return embed;
      }
    }

    if (value) {
      embed = addFields(
        embed,
        {
          name: 'Punishment trigger',
          value
        }
      );
    }

    return embed;
  }

  private async _createWebhook(channel: Snowflake, name: string): Promise<APIWebhook | null> {
    const webhook = await this.rest.post<RESTPostAPIChannelWebhookResult, RESTPostAPIChannelWebhookJSONBody>(
      Routes.channelWebhooks(channel), {
        data: {
          name
        }
      }
    ).catch(() => null);

    if (webhook) {
      const data: WebhookToken = {
        channel_id: channel,
        webhook_id: webhook.id,
        webhook_token: webhook.token!
      };

      await this.sql`
        INSERT INTO webhook_tokens ${this.sql(data)}
        ON CONFLICT (channel_id)
        DO UPDATE SET ${this.sql(data)}
      `;
    }

    return webhook;
  }

  private async _assertWebhook(channel: Snowflake, name: string): Promise<APIWebhook | null> {
    const [data] = await this.sql<[WebhookToken?]>`SELECT * FROM webhook_tokens WHERE channel_id = ${channel}`;
    if (!data) {
      return this._createWebhook(channel, name);
    }

    try {
      return await this.rest.get<APIWebhook>(Routes.webhook(data.webhook_id, data.webhook_token));
    } catch (error) {
      if (!(error instanceof CordisHTTPError) || error.response.status !== 404) {
        return null;
      }

      return this._createWebhook(channel, name);
    }
  }

  private async _handleModLog(log: ModActionLog) {
    log.data = Array.isArray(log.data) ? log.data : [log.data];

    if (!log.data.length) {
      return;
    }

    const [
      { mod_action_log_channel: channelId = null } = {}
    ] = await this.sql<[Pick<GuildSettings, 'mod_action_log_channel'>?]>`
      SELECT mod_action_log_channel FROM guild_settings WHERE guild_id = ${log.data[0]!.guild_id}
    `;

    if (!channelId) {
      return;
    }

    const webhook = await this._assertWebhook(channelId, 'Mod Actions');
    if (!webhook) {
      return;
    }

    const embeds: APIEmbed[] = [];

    for (const entry of log.data) {
      this.logger.metric!({ type: 'mod_action', actionType: CaseAction[entry.action_type], guild: entry.guild_id });

      const [
        { log_message_id: messageId }
      ] = await this.sql<[Pick<Case, 'log_message_id'>]>`SELECT log_message_id FROM cases WHERE id = ${entry.id}`;

      const [target, mod, message] = await Promise.all([
        this.rest.get<APIUser>(Routes.user(entry.target_id)),
        entry.mod_id ? this.rest.get<APIUser>(Routes.user(entry.mod_id)) : Promise.resolve(null),
        messageId ? this.rest.get<APIMessage>(Routes.channelMessage(channelId, messageId)).catch(() => null) : Promise.resolve(null)
      ]);

      let pardonedBy: APIUser | undefined;
      if (entry.pardoned_by) {
        pardonedBy = entry.pardoned_by === mod?.id
          ? mod
          : await this.rest.get(Routes.user(entry.target_id));
      }

      let refCs: Case | undefined;
      if (entry.ref_id) {
        refCs = await this
          .sql<[Case]>`SELECT * FROM cases WHERE case_id = ${entry.ref_id} AND guild_id = ${entry.guild_id}`
          .then(rows => rows[0]);
      }

      let embed = makeCaseEmbed({ logChannelId: channelId, cs: entry, target, mod, pardonedBy, message, refCs });
      if (entry.action_type === CaseAction.warn) {
        embed = this._populateEmbedWithWarnPunishment(embed, entry);
      }

      if (message) {
        return this.rest.patch<unknown, RESTPatchAPIWebhookWithTokenMessageJSONBody>(
          Routes.webhookMessage(webhook.id, webhook.token!, message.id),
          { data: { embeds: [embed] } }
        );
      }

      embeds.push(embed);
    }

    for (let i = 0; i < Math.ceil(embeds.length / 10); i++) {
      void this.rest.post<RESTPostAPIWebhookWithTokenWaitResult, RESTPostAPIWebhookWithTokenJSONBody>(
        `${Routes.webhook(webhook.id, webhook.token)}?wait=true`, {
          data: {
            embeds: embeds.slice(0 + (i * 10), 10 + (i * 10))
          }
        }
      )
        .then(newMessage => this.sql`UPDATE cases SET log_message_id = ${newMessage.id} WHERE id = ${(log.data as Case[])[i]!.id}`);
    }
  }

  private _embedFromTrigger(message: APIMessage, trigger: Exclude<RunnerResult, NotOkRunnerResult>): APIEmbed[] {
    const codeblock = (str: string) => `\`\`\`${str}\`\`\``;

    const embeds: APIEmbed[] = [];
    const push = (embed: APIEmbed) => embeds.push({
      color: 16426011,
      author: {
        name: `${message.author.username}#${message.author.discriminator} (${message.author.id})`,
        icon_url: message.author.avatar
          ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${message.author.id}/${message.author.avatar}`)
          : `${RouteBases.cdn}/embed/avatars/${parseInt(message.author.discriminator, 10) % 5}.png`
      },
      ...embed
    });

    switch (trigger.runner) {
      case Runners.files: {
        const hashes = trigger.data
          .map(file => `${file.file_hash} (${MaliciousFileCategory[file.category]})`)
          .join(', ');

        push({
          title: 'Posted malicious files',
          description: `In <#${message.channel_id}>\n${codeblock(hashes)}`
        });

        break;
      }

      case Runners.urls: {
        break;
      }

      case Runners.globals: {
        const urls = trigger.data
          .map(url => `${url.url} (${'category' in url ? MaliciousUrlCategory[url.category] : 'Fish'})`)
          .join(', ');

        push({
          title: 'Posted malicious urls',
          description: `Blocked URLs:\n${urls}`
        });

        break;
      }

      case Runners.invites: {
        const invites = trigger.data
          .map(invite => `https://discord.gg/${invite}`)
          .join(', ');

        push({
          title: 'Posted unallowed invites',
          description: `In <#${message.channel_id}>\n${codeblock(ellipsis(message.content, 350))}`,
          footer: {
            text: `Blocked invites:\n${invites}`
          }
        });

        break;
      }

      case Runners.words: {
        const { words, urls } = trigger.data.reduce<{ words: string[]; urls: string[] }>((acc, entry) => {
          if (entry.isUrl) {
            acc.urls.push(entry.word);
          } else {
            acc.words.push(entry.word);
          }

          return acc;
        }, { words: [], urls: [] });

        if (words.length) {
          push({
            title: 'Posted prohibited content',
            description: `In <#${message.channel_id}>\n${codeblock(ellipsis(message.content, 350))}`,
            footer: {
              text: `Blocked words:\n${words.join(', ')}`
            }
          });
        }

        if (urls.length) {
          push({
            title: 'Posted prohibited content',
            description: `In <#${message.channel_id}>\n${codeblock(ellipsis(message.content, 350))}`,
            footer: {
              text: `Blocked urls:\n${urls.join(', ')}`
            }
          });
        }

        break;
      }

      case Runners.antispam: {
        const channels = [...new Set(trigger.data.messages.map(m => `<#${m.channel_id}>`))].join(', ');

        push({
          title: 'Triggered anti-spam measures',
          description: `Tried to send ${trigger.data.amount} messages within ${ms(trigger.data.time, true)}\nIn: ${channels}\n\n` +
          `**Deleted spam**:\`\`\`\n${trigger.data.messages.map(m => m.content).join('\n')}\`\`\``
        });

        break;
      }

      case Runners.mentions: {
        const channels = 'messages' in trigger.data
          ? [...new Set(trigger.data.messages.map(m => `<#${m.channel_id}>`))].join(', ')
          : [`<#${trigger.data.message.channel_id}>`];

        const description = 'messages' in trigger.data
          ? `Tried to send ${trigger.data.amount} mentions within ${ms(trigger.data.time, true)}\nIn: ${channels}`
          : `Tried to send ${trigger.data.amount} mentions within a single message`;

        const contents = 'messages' in trigger.data
          ? trigger.data.messages.map(m => m.content).join('\n')
          : trigger.data.message.content;

        push({
          title: 'Triggered anti mention spam measures',
          description: `${description}\n\n**Deleted spam**: \`\`\`\n${contents}\`\`\``
        });

        break;
      }

      default: {
        this.logger.warn({ trigger }, 'Unknown runner type');
      }
    }

    return embeds;
  }

  private async _handleFilterTriggerLog(log: FilterTriggerLog) {
    const [
      { filter_trigger_log_channel: channelId = null } = {}
    ] = await this.sql<[Pick<GuildSettings, 'filter_trigger_log_channel'>?]>`
      SELECT filter_trigger_log_channel FROM guild_settings WHERE guild_id = ${log.data.message.guild_id!}
    `;

    if (!channelId) {
      return;
    }

    const webhook = await this._assertWebhook(channelId, 'Filter trigger');
    if (!webhook) {
      return;
    }

    const embeds = log.data.triggers.flatMap(trigger => {
      this.logger.metric!({
        type: 'filter_trigger',
        triggerType: Runners[trigger.runner],
        data: trigger.data,
        guild: log.data.message.guild_id
      });

      return this._embedFromTrigger(log.data.message, trigger);
    });

    if (!embeds.length) {
      return;
    }

    await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
      Routes.webhook(webhook.id, webhook.token), {
        data: {
          embeds
        }
      }
    );
  }

  private async _handleUserUpdateLogs(settings: GuildSettings, log: ServerLog, logs: GroupedServerLogs) {
    if (!logs[ServerLogType.nickUpdate].length && !logs[ServerLogType.usernameUpdate].length) {
      return;
    }

    if (!settings.user_update_log_channel) {
      return;
    }

    const webhook = await this._assertWebhook(settings.user_update_log_channel, 'User Updates');
    if (!webhook) {
      return;
    }

    const embeds: APIEmbed[] = [];
    const push = (embed: APIEmbed) => embeds.push({
      author: {
        name: `${log.data.user.username}#${log.data.user.discriminator} (${log.data.user.id})`,
        icon_url: log.data.user.avatar
          ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${log.data.user.id}/${log.data.user.avatar}`)
          : `${RouteBases.cdn}/embed/avatars/${parseInt(log.data.user.discriminator, 10) % 5}.png`
      },
      ...embed
    });

    for (const entry of logs[ServerLogType.nickUpdate]) {
      push({
        title: 'Changed their nickname',
        fields: [
          {
            name: 'New nickname',
            value: `>>> ${entry.n ?? 'none'}`
          },
          {
            name: 'Previous nickname',
            value: `>>> ${entry.o ?? 'none'}`
          }
        ]
      });
    }

    for (const entry of logs[ServerLogType.usernameUpdate]) {
      push({
        title: 'Changed their username',
        fields: [
          {
            name: 'New username',
            value: `>>> ${entry.n}`
          },
          {
            name: 'Previous username',
            value: `>>> ${entry.o}`
          }
        ]
      });
    }

    await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
      Routes.webhook(webhook.id, webhook.token), {
        data: {
          embeds
        }
      }
    );
  }

  private async _handleMessageDeleteLogs(settings: GuildSettings, log: ServerLog, logs: GroupedServerLogs) {
    if (!settings.message_update_log_channel) {
      return;
    }

    const webhook = await this._assertWebhook(settings.message_update_log_channel, 'Message Updates');
    if (!webhook) {
      return;
    }

    const [entry] = logs[ServerLogType.messageDelete];
    if (!entry) {
      return;
    }

    const ts = Math.round(getCreationData(entry.message.id).createdTimestamp / 1000);

    await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
      Routes.webhook(webhook.id, webhook.token), {
        data: {
          embeds: [
            {
              author: {
                name: `${log.data.user.username}#${log.data.user.discriminator} (${log.data.user.id})`,
                icon_url: log.data.user.avatar
                  ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${log.data.user.id}/${log.data.user.avatar}`)
                  : `${RouteBases.cdn}/embed/avatars/${parseInt(log.data.user.discriminator, 10) % 5}.png`
              },
              description: `Deleted their message posted <t:${ts}:R> in <#${entry.message.channel_id}>`,
              fields: [
                {
                  name: 'Content',
                  value: entry.message.content.length
                    ? `>>> ${ellipsis(entry.message.content, EMBED_FOOTER_TEXT_LIMIT - 4)}`
                    : 'No content - this message probably held an attachment'
                }
              ],
              footer: entry.mod
                ? {
                  text: `Deleted by ${entry.mod.username}#${entry.mod.discriminator} (${entry.mod.id})`,
                  icon_url: entry.mod.avatar
                    ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${entry.mod.id}/${entry.mod.avatar}`)
                    : `${RouteBases.cdn}/embed/avatars/${parseInt(entry.mod.discriminator, 10) % 5}.png`
                }
                : undefined
            }
          ]
        }
      }
    );
  }

  private async _handleMessageEditLogs(settings: GuildSettings, log: ServerLog, logs: GroupedServerLogs) {
    if (!settings.message_update_log_channel) {
      return;
    }

    const webhook = await this._assertWebhook(settings.message_update_log_channel, 'Message Updates');
    if (!webhook) {
      return;
    }

    const [entry] = logs[ServerLogType.messageEdit];
    if (!entry) {
      return;
    }

    const url = `https://discord.com/channels/${entry.message.guild_id}/${entry.message.channel_id}/${entry.message.id}`;
    const ts = Math.round(getCreationData(entry.message.id).createdTimestamp / 1000);

    await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
      Routes.webhook(webhook.id, webhook.token), {
        data: {
          embeds: [
            {
              author: {
                name: `${log.data.user.username}#${log.data.user.discriminator} (${log.data.user.id})`,
                icon_url: log.data.user.avatar
                  ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${log.data.user.id}/${log.data.user.avatar}`)
                  : `${RouteBases.cdn}/embed/avatars/${parseInt(log.data.user.discriminator, 10) % 5}.png`
              },
              description: `Updated their [message](${url}) posted <t:${ts}:R> in <#${entry.message.channel_id}>`,
              fields: [
                {
                  name: 'New content',
                  value: `>>> ${ellipsis(entry.n, 1020)}`
                },
                {
                  name: 'Previous content',
                  value: `>>> ${ellipsis(entry.o, 1020)}`
                }
              ]
            }
          ]
        }
      }
    );
  }

  private async _handleFilterUpdateLogs(settings: GuildSettings, log: ServerLog, logs: GroupedServerLogs) {
    if (!settings.mod_action_log_channel) {
      return;
    }

    const webhook = await this._assertWebhook(settings.mod_action_log_channel, 'Message Updates');
    if (!webhook) {
      return;
    }

    const [entry] = logs[ServerLogType.filterUpdate];
    if (!entry) {
      return;
    }

    const added = entry.added.map(word => ({ ...word, added: true }));
    const removed = entry.removed.map(word => ({ ...word, added: false }));

    const list = [...added, ...removed]
      .sort((a, b) => a.word.localeCompare(b.word))
      .map(word => {
        const flagsArray = new BanwordFlags(BigInt(word.flags)).toArray();

        const flags = flagsArray.length ? `; flags: ${flagsArray.join(', ')}` : '';
        const duration = word.duration ? `; mute duration: ${word.duration}` : '';

        return `${word.added ? '+' : '-'} "${word.word}"${flags}${duration}`;
      })
      .join('\n');

    await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
      Routes.webhook(webhook.id, webhook.token), {
        data: {
          embeds: [
            {
              author: {
                name: `${log.data.user.username}#${log.data.user.discriminator} (${log.data.user.id})`,
                icon_url: log.data.user.avatar
                  ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${log.data.user.id}/${log.data.user.avatar}`)
                  : `${RouteBases.cdn}/embed/avatars/${parseInt(log.data.user.discriminator, 10) % 5}.png`
              },
              title: 'Updated the banword list',
              description: `\`\`\`diff\n${ellipsis(list, EMBED_DESCRIPTION_LIMIT - 3)}\`\`\``
            }
          ]
        }
      }
    );
  }

  private async _handleServerLog(log: ServerLog) {
    const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${log.data.guild}`;

    if (!settings) {
      return;
    }

    const logs = log.data.logs.reduce<GroupedServerLogs>((acc, current) => {
      // @ts-expect-error - Impossible to tell TS the right array is obtained for the given log type
      acc[current.type].push(current.data);
      return acc;
    }, {
      [ServerLogType.nickUpdate]: [],
      [ServerLogType.usernameUpdate]: [],
      [ServerLogType.messageEdit]: [],
      [ServerLogType.messageDelete]: [],
      [ServerLogType.filterUpdate]: []
    });

    void this._handleUserUpdateLogs(settings, log, logs);
    void this._handleMessageDeleteLogs(settings, log, logs);
    void this._handleMessageEditLogs(settings, log, logs);
    void this._handleFilterUpdateLogs(settings, log, logs);
  }

  private _handleLog(log: Log) {
    switch (log.type) {
      case LogTypes.modAction: {
        return this._handleModLog(log);
      }

      case LogTypes.filterTrigger: {
        return this._handleFilterTriggerLog(log);
      }

      case LogTypes.server: {
        return this._handleServerLog(log);
      }

      default: {
        return this.logger.warn({ log }, 'Recieved unrecognized base log type');
      }
    }
  }

  public async init() {
    const { channel } = await createAmqp(this.config.amqpUrl);
    const interactions = new PubSubSubscriber<Log>(channel);

    await interactions.init({
      name: 'guild_logs',
      fanout: false,
      cb: log => void this._handleLog(log)
    });

    return interactions;
  }
}
