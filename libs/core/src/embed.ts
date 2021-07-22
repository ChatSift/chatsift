import type { APIEmbed, APIEmbedField } from 'discord-api-types/v9';

export const EMBED_TITLE_LIMIT = 256;
export const EMBED_DESCRIPTION_LIMIT = 2048;
export const EMBED_FOOTER_TEXT_LIMIT = 2048;
export const EMBED_AUTHOR_NAME_LIMIT = 256;
export const EMBED_FIELD_LIMIT = 25;
export const EMBED_FIELD_NAME_LIMIT = 256;
export const EMBED_FIELD_VALUE_LIMIT = 1024;
export const MESSAGE_CONTENT_LIMIT = 2000;

export const addFields = (embed: APIEmbed, ...data: APIEmbedField[]): APIEmbed =>
  ({
    ...embed,
    fields: (embed.fields ?? []).concat(data)
  });

export const ellipsis = (text: string, total: number): string => {
  if (text.length <= total) {
    return text;
  }

  const keep = total - 3;
  if (keep < 1) {
    return text.slice(0, total);
  }

  return `${text.slice(0, keep)}...`;
};

export const uniqueValidatedValues = <T>(input: T[]): T[] => Array.from(new Set(input)).filter(element => element);

export const truncateEmbed = (embed: APIEmbed): APIEmbed =>
  ({
    ...embed,
    description: embed.description ? ellipsis(embed.description, EMBED_DESCRIPTION_LIMIT) : undefined,
    title: embed.title ? ellipsis(embed.title, EMBED_TITLE_LIMIT) : undefined,
    author: embed.author
      ? {
        ...embed.author,
        name: embed.author.name ? ellipsis(embed.author.name, EMBED_AUTHOR_NAME_LIMIT) : undefined
			  }
      : undefined,
    footer: embed.footer
      ? {
        ...embed.footer,
        text: ellipsis(embed.footer.text, EMBED_FOOTER_TEXT_LIMIT)
			  }
      : undefined,
    fields: embed.fields
      ? embed.fields
        .map(field => ({
          name: ellipsis(field.name, EMBED_FIELD_NAME_LIMIT),
          value: ellipsis(field.value, EMBED_FIELD_VALUE_LIMIT)
        }))
        .slice(0, EMBED_FIELD_LIMIT)
      : []
  });
