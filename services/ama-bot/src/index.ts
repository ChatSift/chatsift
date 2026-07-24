import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCommandHandlers, registerComponentHandlers } from '@chatsift/bot-core';

const baseDir = dirname(fileURLToPath(import.meta.url));

export async function bin(): Promise<void> {
	await registerComponentHandlers(join(baseDir, 'components'));
	await registerCommandHandlers(join(baseDir, 'commands'));
}
