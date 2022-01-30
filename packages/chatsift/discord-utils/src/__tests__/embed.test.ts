import type { APIEmbed, APIEmbedField } from 'discord-api-types/v9';
import { addFields, ellipsis, MESSAGE_LIMITS, truncateEmbed } from '../embed';

describe('addFields', () => {
	test('no existing fields', () => {
		const embed: APIEmbed = {};

		const field: APIEmbedField = { name: 'foo', value: 'bar' };
		expect(addFields(embed, field)).toStrictEqual({ ...embed, fields: [field] });
	});

	test('existing fields', () => {
		const field: APIEmbedField = { name: 'foo', value: 'bar' };
		const embed: APIEmbed = { fields: [field] };

		expect(addFields(embed, field)).toStrictEqual({ ...embed, fields: [field, field] });
	});
});

describe('ellipsis', () => {
	test('no ellipsis', () => {
		expect(ellipsis('foo', 5)).toBe('foo');
	});

	test('ellipsis', () => {
		expect(ellipsis('foobar', 4)).toBe('f...');
	});

	test('too long for ellipsis', () => {
		expect(ellipsis('foo', 2)).toBe('fo');
	});
});

describe('truncateEmbed', () => {
	test('basic embed properties', () => {
		const embed: APIEmbed = {
			title: 'foo'.repeat(256),
			description: 'bar'.repeat(4096),
			author: { name: 'baz'.repeat(256) },
			footer: { text: 'qux'.repeat(2048) },
		};

		const truncated = truncateEmbed(embed);

		expect(truncated.title).toBe(ellipsis(embed.title, MESSAGE_LIMITS.EMBEDS.TITLE));
		expect(truncated.description).toBe(ellipsis(embed.description, MESSAGE_LIMITS.EMBEDS.DESCRIPTION));
		expect(truncated.author.name).toBe(ellipsis(embed.author.name, MESSAGE_LIMITS.EMBEDS.AUTHOR));
		expect(truncated.footer.text).toBe(ellipsis(embed.footer.text, MESSAGE_LIMITS.EMBEDS.FOOTER));
	});

	test('fields', () => {
		const embed: APIEmbed = {
			fields: Array(30).fill({ name: 'foo', value: 'bar' }),
		};

		expect(truncateEmbed(embed).fields).toHaveLength(MESSAGE_LIMITS.EMBEDS.FIELD_COUNT);
	});
});
