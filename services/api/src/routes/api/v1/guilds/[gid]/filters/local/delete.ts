import { LocalFiltersController } from '#controllers';
import type { ApiDeleteGuildsFiltersLocalBody, BannedWord } from '@automoderator/core';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import * as zod from 'zod';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		jsonParser(),
		validate(
			zod.object({
				words: zod.string().array(),
			}),
			'body',
		),
	];

	public constructor(public readonly controller: LocalFiltersController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { gid } = req.params as { gid: Snowflake };
		const data = req.body as ApiDeleteGuildsFiltersLocalBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const deleted: BannedWord[] = [];
		if (data.words) {
			for (const entry of data.words) {
				const del = await this.controller.delete(gid, entry);
				if (del) {
					deleted.push(del);
				}
			}
		} else {
			deleted.concat(await this.controller.deleteAll(gid));
		}

		if (!deleted.length) {
			return next(notFound('There was nothing to delete'));
		}

		return res.end(JSON.stringify(deleted));
	}
}
