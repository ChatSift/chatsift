/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */

import { Config, kConfig, kSql } from '@automoderator/injection';
import type { NextHandler, Request, Response } from 'polka';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import { internal } from '@hapi/boom';
import { Route } from '@chatsift/rest-utils';
import { userAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [userAuth()];

	public constructor(@inject(kConfig) public readonly config: Config, @inject(kSql) public readonly sql: Sql<{}>) {
		super();
	}

	// TODO(DD): Proper types
	public async handle(req: Request, res: Response, next: NextHandler) {
		const [GHOST_ID, GHOST_SECRET] = this.config.ghostIntegrationKey.split(':') as [string, string];
		const iat = Math.floor(Date.now() / 1000);

		const token = jwt.sign(
			{
				iat,
				exp: iat + 5 * 60,
				aud: '/canary/admin',
			},
			Buffer.from(GHOST_SECRET, 'hex'),
			{ algorithm: 'HS256', keyid: GHOST_ID },
		);

		const params = new URLSearchParams({
			order: 'created_at desc',
			limit: '1000',
			page: '1',
			filter: 'label:[discordoauth]',
			include: 'labels,emailRecipients',
		}).toString();

		const usersRes = await fetch(`${this.config.ghostDomain}/ghost/api/canary/admin/members/?${params}`, {
			headers: {
				Authorization: `Ghost ${token}`,
				'Content-type': 'application/json',
			},
		});

		if (!usersRes.ok) {
			return next(internal('Failed to fetch users from Ghost'));
		}

		const users = await usersRes.json();
		let user = users.members.find((member: any) => {
			try {
				const data = JSON.parse(member.note);
				return data.id === req.user!.id;
			} catch {
				return false;
			}
		});

		const userBody = JSON.stringify({
			members: [
				{
					name: `${req.user!.username}#${req.user!.discriminator}`,
					email: req.user!.email,
					note: JSON.stringify({ id: req.user!.id }),
					subscriptions: [],
					subscribed: true,
					comped: false,
					email_count: 0,
					email_opened_count: 0,
					email_open_rate: null,
					products: [],
					labels: ['DiscordOauth'],
				},
			],
		});

		if (user) {
			const updateRes = await fetch(`${this.config.ghostDomain}/ghost/api/canary/admin/members/${user.id as string}`, {
				method: 'PUT',
				headers: {
					Authorization: `Ghost ${token}`,
					'Content-type': 'application/json',
				},
				body: userBody,
			});

			if (!updateRes.ok) {
				return next(internal('Failed to update Ghost user'));
			}

			const data = await updateRes.json();
			if (data) {
				[user] = data.members;
			}
		} else {
			const createRes = await fetch(`${this.config.ghostDomain}/ghost/api/canary/admin/members`, {
				method: 'POST',
				headers: {
					Authorization: `Ghost ${token}`,
					'Content-type': 'application/json',
				},
				body: userBody,
			});

			if (!createRes.ok) {
				return next(internal('Failed to create Ghost user'));
			}

			const data = await createRes.json();
			if (data) {
				[user] = data.members;
			}
		}

		const signinResponse = await fetch(
			`${this.config.ghostDomain}/ghost/api/canary/admin/members/${user.id as string}/signin_urls`,
			{
				headers: {
					Authorization: `Ghost ${token}`,
					'Content-type': 'application/json',
				},
			},
		);

		if (!signinResponse.ok) {
			return next(internal('Failed to create Ghost user'));
		}

		const data = await signinResponse.json();
		const { url } = data.member_signin_urls[0];

		res.redirect(url);
		return res.end();
	}
}
