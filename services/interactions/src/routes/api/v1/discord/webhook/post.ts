import { injectable, inject } from 'tsyringe';
import { Route, jsonParser } from '@automoderator/rest';
import { unauthorized } from '@hapi/boom';
import * as nacl from 'tweetnacl';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { RoutingServer } from '@cordis/brokers';
import {
  APIInteraction,
  InteractionType,
  InteractionResponseType,
  APIGuildInteraction
} from 'discord-api-types/v8';
import type { DiscordInteractions } from '@automoderator/core';
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
    public readonly interactions: RoutingServer<keyof DiscordInteractions, DiscordInteractions>
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

    const interaction = req.body as APIInteraction;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    if (interaction.type === InteractionType.Ping) {
      return res.end(JSON.stringify({ type: InteractionResponseType.Pong }));
    }

    res.end(JSON.stringify({ type: InteractionResponseType.DeferredChannelMessageWithSource }));

    // TODO: Check on discord-api-types
    switch (interaction.type) {
      case InteractionType.ApplicationCommand: {
        return this.interactions.publish('command', interaction as APIGuildInteraction);
      }

      case InteractionType.MessageComponent: {
        return this.interactions.publish('component', interaction as APIGuildInteraction);
      }

      default: {
        return this.logger.warn({ topic: 'INTERACTIONS WEBHOOK', interaction }, 'Recieved unrecognized interaction type');
      }
    }
  }
}
