import { kLogger } from '@automoderator/injection';
import { addFields } from '@chatsift/discord-utils';
import { getCreationData, makeDiscordCdnUrl } from '@cordis/util';
import { REST } from '@discordjs/rest';
import type {
	APIGuildInteraction,
	APIEmbed,
	APIInvite,
	APIEmbedImage,
	RESTGetAPIGuildPreviewResult,
} from 'discord-api-types/v9';
import { InteractionResponseType, Routes, RouteBases } from 'discord-api-types/v9';
import fetch from 'node-fetch';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { LookupInviteCommand } from '#interactions';
import type { ArgumentsOf } from '#util';
import { send } from '#util';

@injectable()
export default class implements Command {
	public readonly inviteRegex =
		// eslint-disable-next-line unicorn/no-unsafe-regex
		/(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)(?<code>[\w-]{2,})/i;

	public constructor(@inject(kLogger) public readonly logger: Logger, public readonly rest: REST) {}

	public getCode(invite: string) {
		if (this.inviteRegex.test(invite)) {
			return this.inviteRegex.exec(invite)!.groups!.code;
		}

		return invite;
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof LookupInviteCommand>) {
		void send(interaction, {}, InteractionResponseType.DeferredChannelMessageWithSource);

		const code = this.getCode(args.invite);
		// TODO(DD): use the REST API to get the invite
		const res = await fetch(`https://invite-lookup.chatsift.workers.dev/invites/${code!}`);

		if (!res.ok) {
			if (res.status !== 404) {
				this.logger.warn(
					{
						code,
						res,
						// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
						data: await res
							.clone()
							.json()
							.catch(() => null),
					},
					'Failed to fetch invite',
				);
				return send(interaction, { content: 'An unknown error occured fetching the guild data' });
			}

			return send(interaction, { content: 'Invalid/expired invite, could not get any information' });
		}

		const invite = await (res.json() as Promise<APIInvite>);

		if (!invite.guild) {
			return send(interaction, { content: 'Invalid/expired invite, could not get any information' });
		}

		const preview = (await this.rest
			.get(Routes.guildPreview(invite.guild.id))
			.catch(() => null)) as RESTGetAPIGuildPreviewResult | null;
		const timestamp = Math.round(getCreationData(invite.guild.id).createdTimestamp / 1_000);
		const image: APIEmbedImage | undefined = invite.guild.banner
			? {
					url: makeDiscordCdnUrl(`${RouteBases.cdn}/banners/${invite.guild.id}/${invite.guild.banner}`, {
						size: 2_048,
					}),
			  }
			: preview?.discovery_splash
			? {
					url: makeDiscordCdnUrl(
						`${RouteBases.cdn}/discovery-splashes/${invite.guild.id}/${preview.discovery_splash}`,
						{ size: 2_048 },
					),
			  }
			: undefined;

		const embed: APIEmbed = {
			color: 5_793_266,
			author: {
				name: `${invite.guild.name} (${invite.guild.id})`,
				icon_url: invite.guild.icon
					? makeDiscordCdnUrl(`${RouteBases.cdn}/icons/${invite.guild.id}/${invite.guild.icon}`)
					: undefined,
			},
			image,
			fields: [
				{
					name: 'Created at',
					value: `<t:${timestamp}:F> (<t:${timestamp}:R>)`,
					inline: true,
				},
				{
					name: 'Verification level',
					value: `${invite.guild.verification_level}`,
					inline: true,
				},
				{
					name: 'Channel',
					value: `<#${invite.channel!.id}> (#${invite.channel!.name})`,
				},
				{
					name: 'Features',
					value: invite.guild.features.join('\n'),
				},
			],
		};

		if (preview) {
			addFields(
				embed,
				{
					name: 'Member count',
					value: `${preview.approximate_member_count}`,
					inline: true,
				},
				{
					name: 'Emote count',
					value: `${preview.emojis.length}`,
					inline: true,
				},
			);
		}

		return send(interaction, { embeds: [embed] });
	}
}
