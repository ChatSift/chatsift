import { singleton, inject } from 'tsyringe';
import { createAmqp, PubSubSubscriber } from '@cordis/brokers';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { Rest, HTTPError as CordisHTTPError } from '@cordis/rest';
import {
  Log,
  LogTypes,
  CaseAction,
  ModActionLog,
  GuildSettings,
  Case,
  addFields,
  ms,
  WarnCase,
  WarnPunishmentAction,
  makeCaseEmbed,
  FilterTriggerLog,
  WebhookToken,
  RunnerResult,
  NotOkRunnerResult,
  Runners,
  MaliciousFileCategory,
  MaliciousUrlCategory,
  ellipsis
} from '@automoderator/core';
import {
  APIEmbed,
  APIMessage,
  APIUser,
  APIWebhook,
  Snowflake,
  RESTPatchAPIChannelMessageJSONBody,
  RESTPostAPIChannelWebhookJSONBody,
  RESTPostAPIChannelWebhookResult,
  RESTPostAPIWebhookWithTokenJSONBody,
  RESTPostAPIWebhookWithTokenWaitResult,
  RouteBases,
  Routes
} from 'discord-api-types/v9';
import { makeDiscordCdnUrl } from '@cordis/util';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';

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
    const [
      { mod_action_log_channel: channelId = null } = {}
    ] = await this.sql<[Pick<GuildSettings, 'mod_action_log_channel'>?]>`
      SELECT mod_action_log_channel FROM guild_settings WHERE guild_id = ${log.data.guild_id}
    `;

    if (!channelId) {
      return;
    }

    const webhook = await this._assertWebhook(channelId, 'Mod Actions');
    if (!webhook) {
      return;
    }

    const [
      { log_message_id: messageId }
    ] = await this.sql<[Pick<Case, 'log_message_id'>]>`SELECT log_message_id FROM cases WHERE id = ${log.data.id}`;

    const [target, mod, message] = await Promise.all([
      this.rest.get<APIUser>(Routes.user(log.data.target_id)),
      log.data.mod_id ? this.rest.get<APIUser>(Routes.user(log.data.mod_id)) : Promise.resolve(null),
      messageId ? this.rest.get<APIMessage>(Routes.channelMessage(channelId, messageId)).catch(() => null) : Promise.resolve(null)
    ]);

    let pardonedBy: APIUser | undefined;
    if (log.data.pardoned_by) {
      pardonedBy = log.data.pardoned_by === mod?.id
        ? mod
        : await this.rest.get(Routes.user(log.data.target_id));
    }

    let refCs: Case | undefined;
    if (log.data.ref_id) {
      refCs = await this
        .sql<[Case]>`SELECT * FROM cases WHERE case_id = ${log.data.ref_id} AND guild_id = ${log.data.guild_id}`
        .then(rows => rows[0]);
    }

    let embed = makeCaseEmbed({ logChannelId: channelId, cs: log.data, target, mod, pardonedBy, message, refCs });
    if (log.data.action_type === CaseAction.warn) {
      embed = this._populateEmbedWithWarnPunishment(embed, log.data);
    }

    if (message) {
      return this.rest.patch<APIMessage, RESTPatchAPIChannelMessageJSONBody>(
        Routes.channelMessage(channelId, message.id),
        { data: { embed } }
      );
    }

    const newMessage = await this.rest.post<RESTPostAPIWebhookWithTokenWaitResult, RESTPostAPIWebhookWithTokenJSONBody>(
      `${Routes.webhook(webhook.id, webhook.token)}/?wait=true`, {
        data: {
          embeds: [embed]
        }
      }
    );

    return this.sql`UPDATE cases SET log_message_id = ${newMessage.id} WHERE id = ${log.data.id}`;
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
          : `${RouteBases.cdn}/embed/avatars/${parseInt(message.author.discriminator, 10) % 5}`
      },
      ...embed
    });

    switch (trigger.runner) {
      case Runners.files: {
        const hashes = trigger.data
          .map(file => `${file.file_hash} (${MaliciousFileCategory[file.category]})`)
          .join('\n');

        push({
          title: 'Posted malicious files',
          description: `In <#${message.channel_id}>\n${codeblock(hashes)}`
        });

        break;
      }

      case Runners.urls: {
        const urls = trigger.data
          .map(url => `${url.url} (${MaliciousUrlCategory[url.category]})`)
          .join('\n');

        push({
          title: 'Posted malicious urls',
          description: `Blocked URLs:\n${urls}`
        });

        break;
      }

      case Runners.invites: {
        const invites = trigger.data
          .map(invite => `https://discord.gg/${invite}`)
          .join('\n');

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
              text: `Blocked words:\n${words.join('\n')}`
            }
          });
        }

        if (urls.length) {
          push({
            title: 'Posted prohibited content',
            description: `In <#${message.channel_id}>\n${codeblock(ellipsis(message.content, 350))}`,
            footer: {
              text: `Blocked urls:\n${urls.join('\n')}`
            }
          });
        }

        break;
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

    const embeds = log.data.triggers.flatMap(trigger => this._embedFromTrigger(log.data.message, trigger));
    await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
      Routes.webhook(webhook.id, webhook.token), {
        data: {
          embeds
        }
      }
    );
  }

  private _handleLog(log: Log) {
    switch (log.type) {
      case LogTypes.modAction: {
        return this._handleModLog(log);
      }

      case LogTypes.filterTrigger: {
        return this._handleFilterTriggerLog(log);
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
