import { LogIgnoresController } from '#controllers';
import { Route } from '@chatsift/rest-utils';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response, NextHandler } from 'polka';
import { injectable } from 'tsyringe';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [thirdPartyAuth()];

	public constructor(public readonly controller: LogIgnoresController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { cid } = req.params as { cid: Snowflake };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const ignore = await this.controller.remove(cid);

		if (!ignore) {
			return next(notFound("There's no ignore present for that channel."));
		}

		return res.end(JSON.stringify(ignore));
	}
}
