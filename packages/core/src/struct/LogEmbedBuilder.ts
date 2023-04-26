import { EmbedBuilder, inlineCode, time, TimestampStyles } from '@discordjs/builders';
import { ms } from '@naval-base/ms';
import type { Case } from '@prisma/client';
import type { APIEmbed, APIUser } from 'discord-api-types/v10';
import { singleton } from 'tsyringe';
import { getUserAvatarURL } from '../util/getUserAvatarURL.js';

export interface BuildModActionLogOptions {
	cs: Case;
	existingEmbed?: APIEmbed | null;
	mod?: APIUser | null;
	pardonedBy?: APIUser | null;
	refCs?: Case | null;
	user?: APIUser | null;
}

@singleton()
export class LogEmbedBuilder {
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
				iconURL: getUserAvatarURL(user),
			})
			.setFooter(
				cs.modTag && cs.modId
					? {
							text: `Case #${cs.id} | By ${cs.modTag} (${cs.modId})`,
							iconURL: getUserAvatarURL(mod),
					  }
					: null,
			);

		const description = [
			`**Action**: ${cs.actionType}`,
			`**Reason**: ${cs.reason ?? `set a reason using ${inlineCode(`/case reason ${cs.caseId}`)}`}`,
		];

		if (cs.expiresAt) {
			description.push(
				`**Duration**: ${ms(
					cs.duration ? Number(cs.duration) : cs.expiresAt.getTime() - cs.createdAt.getTime(),
					true,
				)}`,
				`**Expires**: ${time(cs.expiresAt, TimestampStyles.RelativeTime)}`,
			);
		}

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
