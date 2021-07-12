import { injectable, inject } from 'tsyringe';
import { Route, jsonParser } from '@automoderator/rest';
import { unauthorized } from '@hapi/boom';
import * as nacl from 'tweetnacl';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import {
  InteractionType,
  InteractionResponseType,
  APIGuildInteraction
} from 'discord-api-types/v8';
import { Handler } from '../../../../../handler';
import { Interaction } from '#util';
import type { Request, Response, NextHandler } from 'polka';
import type { Logger } from 'pino';

@injectable()
export default class PostDiscordWebhookRoute extends Route {
  public override readonly middleware = [
    jsonParser(true)
  ];

  public constructor(
    @inject(kConfig) public readonly config: Config,
    @inject(kLogger) public readonly logger: Logger,
    public readonly handler: Handler
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const signature = req.headers['x-signature-ed25519'] as string | undefined;
    const timestamp = req.headers['x-signature-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      return next(unauthorized('missing signature or timestamp'));
    }

    const isValid = nacl.sign.detached.verify(
      Buffer.from(timestamp + req.rawBody!),
      Buffer.from(signature, 'hex'),
      Buffer.from(this.config.discordPubKey, 'hex')
    );

    if (!isValid) {
      return next(unauthorized('failed to validate request'));
    }

    const interaction: Interaction = { res, ...req.body as APIGuildInteraction };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    if (interaction.type === InteractionType.Ping) {
      return res.end(JSON.stringify({ type: InteractionResponseType.Pong }));
    }

    // TODO: Check on discord-api-types
    switch (interaction.type) {
      case InteractionType.ApplicationCommand: {
        return this.handler.handleCommand(interaction);
      }

      case InteractionType.MessageComponent: {
        return this.handler.handleComponent(interaction);
      }

      default: {
        return this.logger.warn({ interaction }, 'Recieved unrecognized interaction type');
      }
    }
  }
}
