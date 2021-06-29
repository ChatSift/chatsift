import { singleton, inject } from 'tsyringe';
import { createAmqp, PubSubClient } from '@cordis/brokers';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { Log, LogTypes, CaseAction, ModActionLog } from '@automoderator/core';
import type { Logger } from 'pino';

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
    public readonly rest: Rest
  ) {}

  private _handleModLog(log: ModActionLog) {
    switch (log.data.action_type) {
      case CaseAction.warn:
      case CaseAction.strike:
      case CaseAction.mute:
      case CaseAction.unmute:
      case CaseAction.kick:
      case CaseAction.softban:
      case CaseAction.ban:
      case CaseAction.unban: {
        break;
      }

      default: {
        return this.logger.warn({ log }, 'Recieved unrecognized mod log type');
      }
    }
  }

  private _handleLog(log: Log) {
    switch (log.type) {
      case LogTypes.modAction: {
        this._handleModLog(log);
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
