import type { FilterCommand } from '#interactions';
import { ArgumentsOf, send } from '#util';
import type {
	ApiDeleteFiltersUrlsAllowlistCodeResult,
	ApiGetFiltersUrlsAllowlistResult,
	ApiPutFiltersUrlsAllowlistCodeResult,
} from '@automoderator/core';
import { Rest } from '@chatsift/api-wrapper';
import { kLogger } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import type { Command } from '../../../../command';

@singleton()
export class UrlsConfig implements Command {
	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		@inject(kLogger) public readonly logger: Logger,
	) {}

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
		url = url.replace(/https?:\/\//g, '');

		if (url.includes('/')) {
			// Assume that the URL is formatted correctly. Extract the domain (including the subdomain)
			const fullDomain = url.split('/')[0]!;
			return this.extractRoot(fullDomain);
		}

		return this.extractRoot(url);
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['urls']) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'allow': {
				const promises = [];

				for (const entry of args.allow.entries.split(',')) {
					const res = this.rest.put<ApiPutFiltersUrlsAllowlistCodeResult>(
						`/guilds/${interaction.guild_id}/filters/urls/allowlist/${this.cleanDomain(entry)}`,
					);

					promises.push(res);
				}

				const added = (await Promise.allSettled(promises)).filter((promise) => promise.status === 'fulfilled');

				if (!added.length) {
					return send(interaction, { content: 'There was nothing to add!', flags: 64 });
				}

				return send(interaction, { content: 'Successfully added the given entries to the allowlist' });
			}

			case 'unallow': {
				const promises = [];

				for (const entry of args.unallow.entries.split(',')) {
					const res = this.rest.delete<ApiDeleteFiltersUrlsAllowlistCodeResult>(
						`/guilds/${interaction.guild_id}/filters/urls/allowlist/${this.cleanDomain(entry)}`,
					);

					promises.push(res);
				}

				const deleted = (await Promise.allSettled(promises)).filter((promise) => promise.status === 'fulfilled');

				if (!deleted.length) {
					return send(interaction, { content: 'There was nothing to delete!', flags: 64 });
				}

				return send(interaction, { content: 'Successfully removed the given entries from the given allowlist' });
			}

			case 'list': {
				const allows = await this.rest.get<ApiGetFiltersUrlsAllowlistResult>(
					`/guilds/${interaction.guild_id}/filters/urls/allowlist`,
				);

				if (!allows.length) {
					return send(interaction, { content: 'There is currently nothing on your allowlist' });
				}

				const content = allows.map((entry) => entry.domain).join('\n');

				return send(interaction, {
					content: "Here's your list",
					files: [{ name: 'allowlist.txt', content: Buffer.from(content) }],
				});
			}
		}
	}
}
