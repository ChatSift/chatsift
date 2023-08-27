import { EmbedBuilder, inlineCode } from '@discordjs/builders';
import type { APIEmbed, APIUser } from 'discord-api-types/v10';
import { inject, injectable } from 'inversify';
import type { Selectable } from 'kysely';
import type { Case } from '../db.js';
import { Util } from './Util.js';

export interface BuildModActionLogOptions {
	cs: Selectable<Case>;
	existingEmbed?: APIEmbed | null;
	mod?: APIUser | null;
	pardonedBy?: APIUser | null;
	refCases?: Selectable<Case>[] | null;
	referencedBy?: Selectable<Case>[] | null;
	user?: APIUser | null;
}

@injectable()
export class LogEmbedBuilder {
	@inject(Util)
	private readonly util!: Util;

	public readonly caseLogColors = {
		role: 16_022_395,
		unrole: 5_793_266,
		warn: 16_022_395,
		timeout: 16_022_395,
		revokeTimeout: 5_793_266,
		kick: 16_022_395,
		softban: 16_022_395,
		ban: 15_747_144,
		unban: 5_793_266,
	} as const;

	// TODO: Full support for all fields
	public buildModActionLog({ cs, mod, user, existingEmbed, pardonedBy }: BuildModActionLogOptions): APIEmbed {
		const builder = new EmbedBuilder(existingEmbed ?? {})
			.setColor(this.caseLogColors[cs.actionType])
			.setAuthor({
				name: `${this.util.getUserTag(user)} (${cs.targetId})`,
				iconURL: this.util.getUserAvatarURL(user),
			})
			.setFooter(
				cs.modId
					? {
							text: `Case #${cs.id} | By ${this.util.getUserTag(mod)} (${cs.modId})`,
							iconURL: this.util.getUserAvatarURL(mod),
					  }
					: null,
			);

		const description = [
			`**Action**: ${cs.actionType}`,
			`**Reason**: ${cs.reason ?? `set a reason using ${inlineCode(`/case reason ${cs.id}`)}`}`,
		];

		if (pardonedBy) {
			description.push(`**Pardoned By**: ${pardonedBy.username}#${pardonedBy.discriminator} (${pardonedBy.id})`);
		}

		builder.setDescription(description.join('\n'));

		return builder.toJSON();
	}
}
