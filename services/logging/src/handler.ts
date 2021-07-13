import { singleton, inject } from 'tsyringe';
import { createAmqp, PubSubClient } from '@cordis/brokers';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
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
  makeCaseEmbed
} from '@automoderator/core';
import {
  APIEmbed,
  APIMessage,
  APIUser,
  RESTPostAPIChannelMessageJSONBody,
  RESTPatchAPIChannelMessageJSONBody,
  Routes
} from 'discord-api-types/v8';
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
