import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerComponentHandlers } from '@chatsift/bot-core';
import type { Client } from '@discordjs/core';
import { registerBanEvents } from './lib/banEvents.js';

const baseDir = dirname(fileURLToPath(import.meta.url));

/**
 * Appeals' gateway process (#232, docs/roadmap/09-appeals.md).
 *
 * The thinnest bot in the repo, and deliberately so: it registers **no commands of its own** (decision 2 --
 * Appeals has no in-guild entry point, since the appellant is banned and cannot see the server), so the only
 * commands it answers are the `/deploy` and `/dashboard` pair `createBotClient` gives every bot. What it does
 * own is the three buttons on the appeal card `services/api` posts, and the two things a gateway gives that
 * HTTP does not: a correct guild list for free, and ban-list events.
 */
export async function bin(client: Client): Promise<void> {
	await registerComponentHandlers(join(baseDir, 'components'));
	registerBanEvents(client);
}
