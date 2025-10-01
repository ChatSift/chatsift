import type { APIChannel } from 'discord-api-types/v10';
import { ChannelType } from 'discord-api-types/v10';
import { test, expect } from 'vitest';
import { sortChannels } from '../sortChannels.js';

test('sorting a list of channels', () => {
	// Higher position than the category, but should come out on top
	const first = {
		id: '1',
		position: 1,
		type: ChannelType.GuildText,
	} as unknown as APIChannel;

	const second = {
		id: '0',
		position: 0,
		type: ChannelType.GuildCategory,
	} as unknown as APIChannel;

	const third = {
		id: '2',
		position: 0,
		type: ChannelType.GuildText,
		parent_id: '0',
	} as unknown as APIChannel;

	const fourth = {
		id: '3',
		position: 1,
		type: ChannelType.GuildText,
		parent_id: '0',
	} as unknown as APIChannel;

	expect(sortChannels([first, second, third, fourth])).toStrictEqual([first, second, third, fourth]);
});
