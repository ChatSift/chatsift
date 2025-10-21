import { startGuildSyncing } from './lib/client.js';
import { registerHandlers } from './lib/components.js';
import { gateway } from './lib/gateway.js';

export async function bin(): Promise<void> {
	await registerHandlers();

	await gateway.connect();
	startGuildSyncing();
}
