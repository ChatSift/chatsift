import { PrismaClient } from '@prisma/client';
import { kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { Routes, APIMessage, APIInvite } from 'discord-api-types';
import { inject, singleton } from 'tsyringe';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import { MessageCache } from '@automoderator/cache';
import { PubSubPublisher } from '@cordis/brokers';
import type { InvitesRunnerResult, Log } from '@automoderator/broker-types';
import type { IRunner } from './IRunner';
import { dmUser } from '@automoderator/util';

interface InvitesTransform {
	codes: string[];
}

@singleton()
export class InvitesRunner implements IRunner<InvitesTransform, InvitesTransform, InvitesRunnerResult> {
	public readonly inviteRegex =
		/(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)(?<code>[\w\d-]{2,})/gi;

	public readonly invitesWorkerDomain = 'https://invite-lookup.chatsift.workers.dev' as const;

	public constructor(
		@inject(kLogger) public readonly logger: Logger,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
	) {}

	private async fetchInvite(code: string): Promise<APIInvite | null> {
		const res = await fetch(`${this.invitesWorkerDomain}/invites/${code}`);

		if (!res.ok) {
			if (res.status !== 404) {
				this.logger.warn(
					{
						code,
						res,
						data: (await res.json().catch(() => null)) as unknown,
					},
					'Failed to fetch invite',
				);
			}

			return null;
		}

		return res.json() as Promise<APIInvite>;
	}

	public transform(message: APIMessage): InvitesTransform {
		const codes = new Set([...message.content.matchAll(this.inviteRegex)].map((match) => match.groups!.code!));
		return {
			codes: [...codes],
		};
	}

	public check({ codes }: InvitesTransform): boolean {
		return codes.length > 0;
	}

	public async run({ codes }: InvitesTransform, message: APIMessage): Promise<InvitesTransform> {
		const allowedInvites = await this.prisma.allowedInvite.findMany({ where: { guildId: message.guild_id } });
		const allowlist = new Set(allowedInvites.map((invite) => invite.allowedGuildId));
		const invites = await Promise.all(codes.map((code) => this.fetchInvite(code)));

		return {
			codes: invites.reduce<string[]>((acc, invite) => {
				if (invite && !allowlist.has(invite.guild!.id)) {
					acc.push(invite.code);
				}

				return acc;
			}, []),
		};
	}

	public async cleanup(_: InvitesTransform, message: APIMessage): Promise<void> {
		await this.discord
			.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Invite filter trigger' })
			.then(() => dmUser(message.author.id, 'Your message was deleted due to containing an unallowed invite.'))
			.catch(() => null);
	}

	public log({ codes }: InvitesTransform): InvitesRunnerResult['data'] {
		return codes;
	}
}
