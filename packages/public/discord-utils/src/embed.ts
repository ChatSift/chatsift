import type { APIEmbed, APIEmbedField } from 'discord-api-types/v10';

/**
 * Limits commonly encountered with Discord's API
 */
export const MESSAGE_LIMITS = {
	/**
	 * How long a message can be in characters
	 */
	CONTENT: 4_000,
	/**
	 * How many embeds can be in a message
	 */
	EMBED_COUNT: 10,
	/**
	 * Embed specific limits
	 */
	EMBEDS: {
		/**
		 * How long an embed title can be in characters
		 */
		TITLE: 256,
		/**
		 * How long an embed description can be in characters
		 */
		DESCRIPTION: 4_096,
		/**
		 * How long an embed footer can be in characters
		 */
		FOOTER: 2_048,
		/**
		 * How long an embed author can be in characters
		 */
		AUTHOR: 256,
		/**
		 * How many fields an embed can have
		 */
		FIELD_COUNT: 25,
		/**
		 * Field specific limits
		 */
		FIELDS: {
			/**
			 * How long a field name can be in characters
			 */
			NAME: 256,
			/**
			 * How long a field value can be in characters
			 */
			VALUE: 1_024,
		},
	},
} as const;

/**
 * Adds the given fields to an embed - mutating it
 *
 * @param embed - The embed to add fields to
 * @param fields - The fields to add
 */
export function addFields(embed: APIEmbed, ...fields: APIEmbedField[]): APIEmbed {
	(embed.fields ??= []).push(...fields);
	return embed;
}

/**
 * Cuts off text after the given length - appending "..." at the end
 *
 * @param text - The text to cut off
 * @param total - The maximum length of the text
 */
export function ellipsis(text: string, total: number): string {
	if (text.length <= total) {
		return text;
	}

	const keep = total - 3;
	if (keep < 1) {
		return text.slice(0, total);
	}

	return `${text.slice(0, keep)}...`;
}

/**
 * Returns a fully truncated embed - safe to use with Discord's API - does not mutate the given embed
 *
 * @param embed - The embed to truncate
 */
export function truncateEmbed(embed: APIEmbed): APIEmbed {
	// @ts-expect-error - Because of the explicit undefined
	return {
		...embed,
		description: embed.description ? ellipsis(embed.description, MESSAGE_LIMITS.EMBEDS.DESCRIPTION) : undefined,
		title: embed.title ? ellipsis(embed.title, MESSAGE_LIMITS.EMBEDS.TITLE) : undefined,
		author: embed.author
			? {
					...embed.author,
					name: ellipsis(embed.author.name, MESSAGE_LIMITS.EMBEDS.AUTHOR),
				}
			: undefined,
		footer: embed.footer
			? {
					...embed.footer,
					text: ellipsis(embed.footer.text, MESSAGE_LIMITS.EMBEDS.FOOTER),
				}
			: undefined,
		fields: embed.fields
			? embed.fields
					.map((field) => ({
						name: ellipsis(field.name, MESSAGE_LIMITS.EMBEDS.FIELDS.NAME),
						value: ellipsis(field.value, MESSAGE_LIMITS.EMBEDS.FIELDS.VALUE),
					}))
					.slice(0, MESSAGE_LIMITS.EMBEDS.FIELD_COUNT)
			: [],
	};
}
