import { withQueueLock } from '@chatsift/bot-core';

export { withGuildUserLock } from '@chatsift/bot-core';

export async function withMessageLock<Result>(guildMessageId: string, fn: () => Promise<Result>): Promise<Result> {
	return withQueueLock(`message:${guildMessageId}`, fn);
}
