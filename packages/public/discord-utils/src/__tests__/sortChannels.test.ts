import type { APIChannel } from 'discord-api-types/v10';
import { ChannelType } from 'discord-api-types/v10';
import { test, expect } from 'vitest';
import { sortChannels } from '../sortChannels.js';

function channel(overrides: { id: string; parent_id?: string; position?: number; type: ChannelType }): APIChannel {
	return overrides as unknown as APIChannel;
}

const ids = (channels: APIChannel[]): string[] => channels.map((entry) => entry.id);

test('sorting a list of channels', () => {
	const first = channel({ id: '1', position: 1, type: ChannelType.GuildText });
	const second = channel({ id: '0', position: 0, type: ChannelType.GuildCategory });
	const third = channel({ id: '2', position: 0, type: ChannelType.GuildText, parent_id: '0' });
	const fourth = channel({ id: '3', position: 1, type: ChannelType.GuildText, parent_id: '0' });

	expect(sortChannels([first, second, third, fourth])).toStrictEqual([first, second, third, fourth]);
});

test('voice and stage channels survive the sort', () => {
	const text = channel({ id: '1', position: 0, type: ChannelType.GuildText });
	const voice = channel({ id: '2', position: 0, type: ChannelType.GuildVoice });
	const stage = channel({ id: '3', position: 1, type: ChannelType.GuildStageVoice });

	expect(ids(sortChannels([voice, stage, text]))).toStrictEqual(['1', '2', '3']);
});

// `position` is a separate sequence per channel kind, so ordering by it alone interleaves voice channels into
// the text list in an order the server never shows.
test('voice channels sort below text channels regardless of position', () => {
	const voice = channel({ id: '1', position: 0, type: ChannelType.GuildVoice });
	const text = channel({ id: '2', position: 5, type: ChannelType.GuildText });

	expect(ids(sortChannels([voice, text]))).toStrictEqual(['2', '1']);
});

test('the same ordering applies inside a category', () => {
	const category = channel({ id: '0', position: 0, type: ChannelType.GuildCategory });
	const voice = channel({ id: '1', position: 0, type: ChannelType.GuildVoice, parent_id: '0' });
	const text = channel({ id: '2', position: 9, type: ChannelType.GuildText, parent_id: '0' });

	expect(ids(sortChannels([category, voice, text]))).toStrictEqual(['0', '2', '1']);
});

// A media post is a thread whose parent is the media channel, so dropping the parent dropped every post too.
test('media channels and their posts survive the sort', () => {
	const media = channel({ id: '1', position: 0, type: ChannelType.GuildMedia });
	const post = channel({ id: '9', type: ChannelType.PublicThread, parent_id: '1' });

	expect(ids(sortChannels([post, media]))).toStrictEqual(['1', '9']);
});

// The consumer indents threads under the row above them, so emitting a category's threads in one block after
// its last channel attributed every thread to the wrong parent.
test('threads follow their own parent channel, not the end of the category', () => {
	const category = channel({ id: '0', position: 0, type: ChannelType.GuildCategory });
	const firstChannel = channel({ id: '1', position: 0, type: ChannelType.GuildText, parent_id: '0' });
	const secondChannel = channel({ id: '2', position: 1, type: ChannelType.GuildText, parent_id: '0' });
	const firstThread = channel({ id: '10', type: ChannelType.PublicThread, parent_id: '1' });
	const secondThread = channel({ id: '20', type: ChannelType.PublicThread, parent_id: '2' });

	expect(ids(sortChannels([category, firstChannel, secondChannel, firstThread, secondThread]))).toStrictEqual([
		'0',
		'1',
		'10',
		'2',
		'20',
	]);
});

test('channels with no place in a guild tree are still dropped', () => {
	const text = channel({ id: '1', position: 0, type: ChannelType.GuildText });
	const dm = channel({ id: '2', type: ChannelType.DM });
	const directory = channel({ id: '3', position: 1, type: ChannelType.GuildDirectory });

	expect(ids(sortChannels([text, dm, directory]))).toStrictEqual(['1']);
});
