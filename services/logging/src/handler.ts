import { singleton, inject } from 'tsyringe';
import { createAmqp, PubSubClient } from '@cordis/brokers';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { Log, LogTypes, CaseAction, ModActionLog, GuildSettings, Case, addFields } from '@automoderator/core';
import { makeDiscordCdnUrl } from '@cordis/util';
import {
  APIEmbed,
  APIMessage,
  APIUser,
  RouteBases,
  RESTPostAPIChannelMessageJSONBody,
  RESTPatchAPIChannelMessageJSONBody,
  Routes
} from 'discord-api-types/v8';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';

@singleton()
export class Handler {
  public readonly LOG_COLORS = {
    [CaseAction.warn]: 15309853,
    [CaseAction.strike]: 15309853,
    [CaseAction.mute]: 2895667,
    [CaseAction.unmute]: 5793266,
    [CaseAction.kick]: 15418782,
    [CaseAction.softban]: 15418782,
    [CaseAction.ban]: 15548997,
    [CaseAction.unban]: 5793266
  } as const;

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kLogger) public readonly logger: Logger,
    @inject(kSql) public readonly sql: Sql<{}>,
    public readonly rest: Rest
  ) {}

  private async _handleModLog(log: ModActionLog) {
    const [
      { mod_action_log_channel: channelId = null } = {}
    ] = await this.sql<[Pick<GuildSettings, 'mod_action_log_channel'>?]>`
      SELECT mod_action_log_channel FROM guild_settings WHERE guild_id = ${log.data.guild_id}
    `;

    const [
      { log_message_id: messageId }
    ] = await this.sql<[Pick<Case, 'log_message_id'>]>`SELECT log_message_id FROM cases WHERE id = ${log.data.id}`;

    if (!channelId) {
      return;
    }

    const [target, mod, message] = await Promise.all([
      this.rest.get<APIUser>(Routes.user(log.data.target_id)),
      log.data.mod_id ? this.rest.get<APIUser>(Routes.user(log.data.mod_id)) : Promise.resolve(null),
      messageId ? this.rest.get<APIMessage>(Routes.channelMessage(channelId, messageId)).catch(() => null) : Promise.resolve(null)
    ]);

    // TODO keep in mind mod info for log updates
    let embed: APIEmbed = message?.embeds[0]
      ? message.embeds[0]
      : {
        color: this.LOG_COLORS[log.data.action_type],
        author: {
          name: `${log.data.target_tag} (${log.data.target_id})`,
          icon_url: target.avatar
            ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${target.id}/${target.avatar}`)
            : `${RouteBases.cdn}/embed/avatars/${parseInt(target.discriminator, 10) % 5}`
        },
        footer: {
          text: `Case ${log.data.case_id}${log.data.mod_tag ? ` | By ${log.data.mod_tag} (${log.data.mod_id!})` : ''}`,
          icon_url: mod
            ? (
              mod.avatar
                ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${mod.id}/${mod.avatar}`)
                : `${RouteBases.cdn}/embed/avatars/${parseInt(mod.discriminator, 10) % 5}`
            )
            : undefined
        }
      };

    if (log.data.ref_id && !embed.fields?.length) {
      const [ref] = await this.sql<[Case]>`SELECT * FROM cases WHERE case_id = ${log.data.ref_id} AND guild_id = ${log.data.guild_id}`;
      embed = addFields(
        embed,
        {
          name: 'Reference',
          value: ref.log_message_id
            ? `[#${ref.case_id}](https://discord.com/channels/${log.data.guild_id}/${channelId}/${ref.log_message_id})`
            : `#${ref.case_id}`
        }
      );
    }

    switch (log.data.action_type) {
      case CaseAction.warn: {
        embed.title = `Was warned${log.data.reason ? ` | ${log.data.reason}` : ''}`;
        break;
      }
      case CaseAction.strike:
      case CaseAction.mute:
      case CaseAction.unmute: {
        break;
      }
      case CaseAction.kick: {
        embed.title = `Was kicked${log.data.reason ? ` | ${log.data.reason}` : ''}`;
        break;
      }
      case CaseAction.softban: {
        embed.title = `Was softbanned${log.data.reason ? ` | ${log.data.reason}` : ''}`;
        break;
      }
      case CaseAction.ban: {
        break;
      }
      case CaseAction.unban: {
        embed.title = `Was unbanned${log.data.reason ? ` | ${log.data.reason}` : ''}`;
        break;
      }

      default: {
        return this.logger.warn({ log }, 'Recieved unrecognized mod log type');
      }
    }

    if (message) {
      return this.rest.patch<APIMessage, RESTPatchAPIChannelMessageJSONBody>(
        Routes.channelMessage(channelId, message.id),
        { data: { embed } }
      );
    }

    const newMessage = await this.rest.post<APIMessage, RESTPostAPIChannelMessageJSONBody>(
      Routes.channelMessages(channelId),
      { data: { embed } }
    );

    return this.sql`UPDATE cases SET log_message_id = ${newMessage.id} WHERE id = ${log.data.id}`;
  }

  private async _handleLog(log: Log) {
    switch (log.type) {
      case LogTypes.modAction: {
        await this._handleModLog(log);
        break;
      }

      default: {
        return this.logger.warn({ log }, 'Recieved unrecognized base log type');
      }
    }
  }

  public async init() {
    const { channel } = await createAmqp(this.config.amqpUrl);
    const interactions = new PubSubClient<Log>(channel);

    await interactions.init({
      name: 'guild_logs',
      fanout: false,
      cb: log => void this._handleLog(log)
    });

    return interactions;
  }
}
