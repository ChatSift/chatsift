import { ApiPutFiltersUrlsBody, MaliciousUrl, MaliciousUrlCategory } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { thirdPartyAuth } from '../../../../../../middleware';

@injectable()
export default class PostFiltersUrlsBulkRoute extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		jsonParser(),
		validate(
			zod
				.object({
					url: zod.string(),
					category: zod.number().min(MaliciousUrlCategory.malicious).max(MaliciousUrlCategory.urlShortner),
				})
				.array(),
			'body',
		),
	];

	public constructor(@inject(kSql) public readonly sql: Sql<{}>) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const urls = req.body as ApiPutFiltersUrlsBody;

		const data = await this.sql.begin(async (sql) => {
			await sql`DELETE FROM malicious_urls`;
			const promises: Promise<MaliciousUrl>[] = [];

			for (const url of urls) {
				const promise = sql<[MaliciousUrl]>`
          INSERT INTO malicious_urls (url, category)
          VALUES (${url.url}, ${url.category})
          RETURNING *
        `.then((rows) => rows[0]);

				promises.push(promise);
			}

			return Promise.all(promises);
		});

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(data));
	}
}
