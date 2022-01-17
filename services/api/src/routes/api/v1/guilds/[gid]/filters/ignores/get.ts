import { FilterIgnoresController } from '#controllers';
import { Route } from '@chatsift/rest-utils';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [thirdPartyAuth()];

	public constructor(public readonly controller: FilterIgnoresController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { gid } = req.params as { gid: Snowflake };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const ignores = await this.controller.getAll(gid);
		return res.end(JSON.stringify(ignores));
	}
}
