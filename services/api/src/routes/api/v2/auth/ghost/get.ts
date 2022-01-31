import { Config, kConfig } from '@automoderator/injection';
import type { Request, Response } from 'polka';
import { inject, injectable } from 'tsyringe';
import { Route } from '@chatsift/rest-utils';

@injectable()
// Noop route serving the purpose of allowing browsers to register cookies
export default class extends Route {
	public constructor(@inject(kConfig) public readonly config: Config) {
		super();
	}

	public async handle(_: Request, res: Response) {
		await new Promise((resolve) => setTimeout(resolve, 2000));

		res.redirect(`${this.config.apiDomain}/api/v2/auth/ghost/callback`);
		return res.end();
	}
}
