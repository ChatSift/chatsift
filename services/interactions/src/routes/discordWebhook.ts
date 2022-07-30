import { Config, kConfig, kLogger } from '@automoderator/injection';
import { jsonParser, Route, RouteMethod } from '@chatsift/rest-utils';
import { unauthorized } from '@hapi/boom';
import { APIGuildInteraction, APIInteraction, InteractionResponseType, InteractionType } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { NextHandler, Request, Response } from 'polka';
import { inject, singleton } from 'tsyringe';
import * as nacl from 'tweetnacl';
import { Handler } from '#handler';
import type { Interaction } from '#util';

@singleton()
export class WebhookRoute extends Route<unknown, unknown> {
	public readonly info = {
		path: '/api/v2/discord/webhook/post',
		method: RouteMethod.post,
	} as const;

	public override readonly middleware = [jsonParser(true)];

	public constructor(
		@inject(kConfig) public readonly config: Config,
		@inject(kLogger) public readonly logger: Logger,
		public readonly handler: Handler,
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
			Buffer.from(this.config.discordPubKey, 'hex'),
		);

		if (!isValid) {
			return next(unauthorized('failed to validate request'));
		}

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		if ((req.body as APIInteraction).type === InteractionType.Ping) {
			return res.end(JSON.stringify({ type: InteractionResponseType.Pong }));
		}

		const interaction: Interaction = { res, ...(req.body as APIGuildInteraction) };

		switch (interaction.type) {
			case InteractionType.ApplicationCommand: {
				return this.handler.handleCommand(interaction);
			}

			case InteractionType.MessageComponent: {
				return this.handler.handleComponent(interaction);
			}

			case InteractionType.ModalSubmit: {
				return this.handler.handleModal(interaction);
			}

			default: {
				return this.logger.warn({ interaction }, 'Recieved unrecognized interaction type');
			}
		}
	}
}
