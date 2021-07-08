import { singleton, inject } from 'tsyringe';
import { createAmqp, PubSubClient } from '@cordis/brokers';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { Log, LogTypes, ModAction, ModActionLog } from '@automoderator/core';
import type { Logger } from 'pino';

@singleton()
export class Handler {
  public readonly LOG_COLORS = {
    [ModAction.warn]: 15309853,
    [ModAction.strike]: 15309853,
    [ModAction.mute]: 2895667,
    [ModAction.unmute]: 5793266,
    [ModAction.kick]: 15418782,
    [ModAction.softban]: 15418782,
    [ModAction.ban]: 15548997,
    [ModAction.unban]: 5793266
  } as const;

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kLogger) public readonly logger: Logger,
    public readonly rest: Rest
  ) {}

  private _handleModLog(log: ModActionLog) {
    switch (log.data.type) {
      case ModAction.warn:
      case ModAction.strike:
      case ModAction.mute:
      case ModAction.unmute:
      case ModAction.kick:
      case ModAction.softban:
      case ModAction.ban:
      case ModAction.unban: {
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
