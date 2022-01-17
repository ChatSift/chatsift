import type { AllowedUrl } from '@automoderator/core';
import { Rest } from '@chatsift/api-wrapper';
import { kLogger, kSql } from '@automoderator/injection';
import type { Snowflake } from 'discord-api-types/v9';
import { readFileSync } from 'fs';
import { join as joinPath } from 'path';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class UrlsRunner {
	public readonly urlRegex = /([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm;
	public readonly tlds: Set<string>;

	public constructor(
		public readonly rest: Rest,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kSql) public readonly sql: Sql<{}>,
	) {
		const contents = readFileSync(joinPath(__dirname, '..', '..', 'tlds.txt'), 'utf8');
		this.tlds = contents.split('\n').reduce((acc, line) => {
			if (!line.startsWith('#') && line.length) {
				acc.add(line.toLowerCase());
			}

			return acc;
		}, new Set<string>());

		logger.debug({ tlds: [...this.tlds] }, 'Successfully computed valid tlds');
	}

	public precheck(content: string): string[] {
		const urls = [...content.matchAll(this.urlRegex)].reduce<Set<string>>((acc, match) => {
			if (this.tlds.has(match.groups!.tld!.toLowerCase())) {
				acc.add(match[0]!);
			}

			return acc;
		}, new Set());

		return [...urls];
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
		url = url.replace(/https?:\/\//g, '');

		if (url.includes('/')) {
			// Assume that the URL is formatted correctly. Extract the domain (including the subdomain)
			const fullDomain = url.split('/')[0]!;
			return this.extractRoot(fullDomain);
		}

		return this.extractRoot(url);
	}

	public async run(urls: string[], guildId: Snowflake) {
		const allowlist = new Set(
			await this.sql<AllowedUrl[]>`SELECT * FROM allowed_urls WHERE guild_id = ${guildId}`.then((rows) =>
				rows.map((row) => this.cleanDomain(row.domain)),
			),
		);

		return urls.filter((url) => !allowlist.has(this.cleanDomain(url)));
	}
}
