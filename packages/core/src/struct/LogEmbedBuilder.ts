import { EmbedBuilder, inlineCode, time, TimestampStyles } from '@discordjs/builders';
import { ms } from '@naval-base/ms';
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
	refCs?: Selectable<Case> | null;
	user?: APIUser | null;
}

@injectable()
export class LogEmbedBuilder {
	@inject(Util)
	private readonly util!: Util;

	public readonly caseLogColors = {
		warn: 16_022_395,
		mute: 16_022_395,
		unmute: 5_793_266,
		kick: 16_022_395,
		softban: 16_022_395,
		ban: 15_747_144,
		unban: 5_793_266,
	} as const;

	public buildModActionLog({ cs, mod, user, existingEmbed, refCs, pardonedBy }: BuildModActionLogOptions): APIEmbed {
		const builder = new EmbedBuilder(existingEmbed ?? {})
			.setColor(this.caseLogColors[cs.actionType])
			.setAuthor({
				name: `${cs.targetTag} (${cs.targetId})`,
				iconURL: this.util.getUserAvatarURL(user),
			})
			.setFooter(
				cs.modTag && cs.modId
					? {
							text: `Case #${cs.id} | By ${cs.modTag} (${cs.modId})`,
							iconURL: this.util.getUserAvatarURL(mod),
					  }
					: null,
			);

		const description = [
			`**Action**: ${cs.actionType}`,
			`**Reason**: ${cs.reason ?? `set a reason using ${inlineCode(`/case reason ${cs.caseId}`)}`}`,
		];

		if (refCs) {
			description.push(`**Referenced Case**: ${refCs.id}`);
		}

		if (pardonedBy) {
			description.push(`**Pardoned By**: ${pardonedBy.username}#${pardonedBy.discriminator} (${pardonedBy.id})`);
		}

		builder.setDescription(description.join('\n'));

		return builder.toJSON();
	}
}
