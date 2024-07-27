// Sourced from https://github.com/Naval-Base/yuudachi/blob/e398023952eeb2451af2c29884d9b848a5051985/apps/yuudachi/src/functions/logging/formatMessageToEmbed.ts#L6

// Copyright (C) 2021  Noel Buechler

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

import { truncateEmbed } from '@chatsift/discord-utils';
import type { APIMessage } from '@discordjs/core';
import { DiscordSnowflake } from '@sapphire/snowflake';
import { userToEmbedAuthor } from './userToEmbedData.js';

export function formatMessageToEmbed(message: APIMessage) {
	const embed = truncateEmbed({
		author: userToEmbedAuthor(message.author, message.author.id),
		description: message.content.length ? message.content : 'No content',
		timestamp: new Date(DiscordSnowflake.timestampFrom(message.id)).toISOString(),
	});

	const attachment = message.attachments[0];

	const attachmentIsImage = ['image/jpeg', 'image/png', 'image/gif'].includes(attachment?.content_type ?? '');
	const attachmentIsImageNaive = ['.jpg', '.png', '.gif'].some((ext) => attachment?.filename?.endsWith(ext));

	if (attachment && (attachmentIsImage || attachmentIsImageNaive)) {
		embed.image = {
			url: attachment.url,
		};
	}

	return embed;
}
