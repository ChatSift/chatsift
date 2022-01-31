/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */

import { Config, kConfig, kSql } from '@automoderator/injection';
import type { NextHandler, Request, Response } from 'polka';
import { inject, injectable } from 'tsyringe';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import { badRequest, internal } from '@hapi/boom';
import { Route, validate } from '@chatsift/rest-utils';
import { userAuth } from '#middleware';
import { State, discordOAuth2 } from '#util';
import { GetAuthGhostQuerySchema, GetAuthGhostQuery } from '@chatsift/api-wrapper/v2';
import cookie from 'cookie';
import type { APIUser } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import type { User } from '@automoderator/core';

@injectable()
export default class extends Route {
	public override readonly middleware = [validate(GetAuthGhostQuerySchema, 'query'), userAuth(true)];

	public constructor(@inject(kConfig) public readonly config: Config, @inject(kSql) public readonly sql: Sql<{}>) {
		super();
	}

	// TODO(DD): Proper types
	public async handle(req: Request, res: Response, next: NextHandler) {
		const query = req.query as GetAuthGhostQuery;
		const stateQuery = query && 'state' in query ? query.state : undefined;

		if (stateQuery) {
			const cookies = cookie.parse(req.headers.cookie ?? '');
			if (stateQuery !== cookies.state) {
				return next(badRequest('invalid state'));
			}

			res.cookie('state', 'noop', { httpOnly: true, path: '/', expires: new Date('1970-01-01') });

			const response = await discordOAuth2(req, res, next, `${this.config.apiDomain}/api/v2/auth/ghost`);
			if (!response) {
				return;
			}

			res.cookie('access_token', response.access_token, {
				expires: new Date(Date.now() + response.expires_in * 1000),
				sameSite: 'strict',
				httpOnly: true,
				domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
				path: '/',
			});

			res.cookie('refresh_token', response.refresh_token, {
				expires: new Date(2030, 1),
				sameSite: 'strict',
				httpOnly: true,
				domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
				path: '/',
			});

			const user = await fetch('https://discord.com/api/v9/users/@me', {
				headers: {
					authorization: `Bearer ${response.access_token}`,
				},
			}).then((res) => res.json() as Promise<APIUser & { perms: bigint }>);

			await this.sql`INSERT INTO users (user_id, perms) VALUES (${user.id}, 0) ON CONFLICT DO NOTHING`;

			req.user = user;
			const [{ perms }] = await this.sql<[Pick<User, 'perms'>]>`SELECT perms FROM users WHERE user_id = ${req.user.id}`;
			req.user.perms = BigInt(perms);
		} else if (!req.user) {
			const redirectUri = `${this.config.apiDomain}/api/v2/auth/ghost`;
			const state = new State(redirectUri).toString();

			const params = new URLSearchParams({
				client_id: this.config.discordClientId,
				redirect_uri: redirectUri,
				response_type: 'code',
				scope: this.config.discordScopes,
				state,
			});

			res.cookie('state', state, { httpOnly: true, path: '/' });
			res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);

			return res.end();
		}

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
					name: `${req.user.username}#${req.user.discriminator}`,
					email: req.user.email,
					note: JSON.stringify({ id: req.user.id }),
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
		const [{ url }] = data.member_signin_urls;

		res.redirect(url);
		return res.end();
	}
}
