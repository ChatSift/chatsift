import { Buffer } from 'node:buffer';
import { REST } from '@discordjs/rest';
import type { GuildSettings } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { stripIndents } from 'common-tags';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler } from '../../handler';
import type { FilterCommand } from '#interactions';
import type { ArgumentsOf } from '#util';
import { send } from '#util';

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: REST,
		public readonly prisma: PrismaClient,
		public readonly handler: Handler,
	) {}

	private async sendCurrentSettings(interaction: APIGuildInteraction, settings?: Partial<GuildSettings> | null) {
		// eslint-disable-next-line no-param-reassign
		settings ??= await this.prisma.guildSettings.findFirst({ where: { guildId: interaction.guild_id } });

		return send(interaction, {
			content: stripIndents`
        **Here are your current filter settings:**
        • url filter: ${settings?.useUrlFilters ? 'on' : 'off'}
        • global filter: ${settings?.useGlobalFilters ? 'on' : 'off'}
        • invite filter: ${settings?.useInviteFilters ? 'on' : 'off'}
      `,
			allowed_mentions: { parse: [] },
		});
	}

	private async handleConfig(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['config']) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'show': {
				return this.sendCurrentSettings(interaction);
			}

			case 'edit': {
				let settings: Partial<GuildSettings> = {};

				if (args.edit.urls !== null) {
					settings.useUrlFilters = args.edit.urls;
				}

				if (args.edit.invites !== null) {
					settings.useInviteFilters = args.edit.invites;
				}

				if (args.edit.global !== null) {
					settings.useGlobalFilters = args.edit.global;
				}

				if (!Object.values(settings).length) {
					return this.sendCurrentSettings(interaction);
				}

				settings = await this.prisma.guildSettings.upsert({
					create: { ...settings, guildId: interaction.guild_id },
					update: settings,
					where: { guildId: interaction.guild_id },
				});

				return this.sendCurrentSettings(interaction, settings);
			}
		}
	}

	private async handleInvite(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['invites']) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'allow': {
				try {
					await this.prisma.allowedInvite.create({
						data: {
							guildId: interaction.guild_id,
							allowedGuildId: args.allow.guild,
						},
					});

					return await send(interaction, { content: 'Successfully added the given guild to the allowlist' });
				} catch {
					return send(interaction, { content: 'There was nothing to add!', flags: 64 });
				}
			}

			case 'unallow': {
				try {
					await this.prisma.allowedInvite.delete({
						where: { guildId_allowedGuildId: { guildId: interaction.guild_id, allowedGuildId: args.unallow.guild } },
					});

					return await send(interaction, {
						content: 'Successfully removed the given guild from the allowlist',
					});
				} catch {
					return send(interaction, { content: 'There was nothing to delete!', flags: 64 });
				}
			}

			case 'list': {
				const allows = await this.prisma.allowedInvite.findMany({ where: { guildId: interaction.guild_id } });

				if (!allows.length) {
					return send(interaction, { content: 'There is currently nothing on your allowlist' });
				}

				const content = allows.map((entry) => entry.allowedGuildId).join('\n');

				return send(interaction, {
					content: "Here's your list",
					files: [{ name: 'allowlist.txt', data: Buffer.from(content) }],
				});
			}
		}
	}

	private extractRoot(url: string): string {
		const split = url.split('.');
		// This means that we've got at least 1 subdomain - there could be more nested
		if (split.length > 2) {
			// Extract the root domain
			return split.slice(split.length - 2, split.length).join('.');
		}

		return url;
	}

	private cleanDomain(url: string) {
		// eslint-disable-next-line no-param-reassign
		url = url.replace(/https?:\/\//g, '');

		if (url.includes('/')) {
			// Assume that the URL is formatted correctly. Extract the domain (including the subdomain)
			const fullDomain = url.split('/')[0]!;
			return this.extractRoot(fullDomain);
		}

		return this.extractRoot(url);
	}

	private async handleUrl(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['urls']) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'allow': {
				try {
					await this.prisma.allowedUrl.create({
						data: {
							guildId: interaction.guild_id,
							domain: this.cleanDomain(args.allow.entry),
						},
					});

					return await send(interaction, { content: 'Successfully added the given url to the allowlist', flags: 64 });
				} catch {
					return send(interaction, { content: 'There was nothing to add!', flags: 64 });
				}
			}

			case 'unallow': {
				try {
					await this.prisma.allowedUrl.delete({
						where: { guildId_domain: { guildId: interaction.guild_id, domain: args.unallow.entry } },
					});

					return await send(interaction, {
						content: 'Successfully removed the given entries from the given allowlist',
					});
				} catch {
					return send(interaction, { content: 'There was nothing to delete!', flags: 64 });
				}
			}

			case 'list': {
				const allows = await this.prisma.allowedUrl.findMany({ where: { guildId: interaction.guild_id } });

				if (!allows.length) {
					return send(interaction, { content: 'There is currently nothing on your allowlist' });
				}

				const content = allows.map((entry) => entry.domain).join('\n');

				return send(interaction, {
					content: "Here's your list",
					files: [{ name: 'allowlist.txt', data: Buffer.from(content) }],
				});
			}
		}
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'config': {
				return this.handleConfig(interaction, args.config);
			}

			case 'invites': {
				return this.handleInvite(interaction, args.invites);
			}

			case 'urls': {
				return this.handleUrl(interaction, args.urls);
			}
		}
	}
}
