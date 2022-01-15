import { ApiPutFiltersUrlsBody, MaliciousUrl, MaliciousUrlCategory } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export default class PostFiltersUrlsBulkRoute extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		jsonParser(),
		validate(
			Joi.array()
				.items(
					Joi.object()
						.keys({
							url: Joi.string().required(),
							category: Joi.number()
								.min(MaliciousUrlCategory.malicious)
								.max(MaliciousUrlCategory.urlShortner)
								.required(),
						})
						.required(),
				)
				.required(),
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
