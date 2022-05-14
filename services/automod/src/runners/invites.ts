import { PrismaClient } from '@prisma/client';
import { kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { Routes, APIMessage, APIInvite } from 'discord-api-types/v9';
import { inject, singleton } from 'tsyringe';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import { MessageCache } from '@automoderator/cache';
import { PubSubPublisher } from '@cordis/brokers';
import { InvitesRunnerResult, Log, Runners } from '@automoderator/broker-types';
import type { IRunner } from './IRunner';
import { dmUser } from '@automoderator/util';

interface InvitesTransform {
	codes: string[];
	use: boolean;
}

@singleton()
export class InvitesRunner implements IRunner<InvitesTransform, InvitesTransform, InvitesRunnerResult> {
	public readonly ignore = 'invites';

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

	public async transform(message: APIMessage): Promise<InvitesTransform> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });

		const codes = new Set([...message.content.matchAll(this.inviteRegex)].map((match) => match.groups!.code!));
		return {
			codes: [...codes],
			use: settings?.useInviteFilters ?? false,
		};
	}

	public check({ use, codes }: InvitesTransform): boolean {
		return use && codes.length > 0;
	}

	public async run({ use, codes }: InvitesTransform, message: APIMessage): Promise<InvitesTransform | null> {
		const allowedInvites = await this.prisma.allowedInvite.findMany({ where: { guildId: message.guild_id } });
		const allowlist = new Set(allowedInvites.map((invite) => invite.allowedGuildId));
		const invites = await Promise.all(codes.map((code) => this.fetchInvite(code)));
		const triggered = invites.reduce<string[]>((acc, invite) => {
			if (invite && !allowlist.has(invite.guild!.id)) {
				acc.push(invite.code);
			}

			return acc;
		}, []);

		if (!triggered.length) {
			return null;
		}

		return {
			use,
			codes: triggered,
		};
	}

	public async cleanup(_: InvitesTransform, message: APIMessage): Promise<void> {
		await this.discord
			.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Invite filter trigger' })
			.then(() => dmUser(message.author.id, 'Your message was deleted due to containing an unallowed invite.'))
			.catch(() => null);
	}

	public log({ codes }: InvitesTransform): InvitesRunnerResult {
		return { runner: Runners.invites, data: codes };
	}
}
