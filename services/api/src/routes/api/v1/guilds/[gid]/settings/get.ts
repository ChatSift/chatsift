import { SettingsController } from '#controllers';
import { Route } from '@chatsift/rest-utils';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { userOrThirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [userOrThirdPartyAuth()];

	public constructor(public readonly controller: SettingsController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { gid } = req.params as { gid: Snowflake };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const settings = (await this.controller.get(gid)) ?? { guild_id: gid };
		return res.end(JSON.stringify(settings));
	}
}
