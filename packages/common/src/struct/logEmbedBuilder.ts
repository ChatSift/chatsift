import { EmbedBuilder, inlineCode, time, TimestampStyles } from '@discordjs/builders';
import { ms } from '@naval-base/ms';
import type { Case } from '@prisma/client';
import type { APIEmbed, APIUser } from 'discord-api-types/v10';
import { singleton } from 'tsyringe';
import { getUserAvatarURL } from '../util/getUserAvatarURL';

export interface BuildModActionLogOptions {
	cs: Case;
	mod?: APIUser | null;
	user?: APIUser | null;
	existingEmbed?: APIEmbed | null;
	refCs?: Case | null;
	pardonedBy?: APIUser | null;
}

@singleton()
export class LogEmbedBuilder {
	public readonly logColors = {
		warn: 16022395,
		mute: 16022395,
		unmute: 5793266,
		kick: 16022395,
		softban: 16022395,
		ban: 15747144,
		unban: 5793266,
	} as const;

	public buildModActionLog({ cs, mod, user, existingEmbed, refCs, pardonedBy }: BuildModActionLogOptions): APIEmbed {
		const builder = new EmbedBuilder(existingEmbed ?? {})
			.setColor(this.logColors[cs.actionType])
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
