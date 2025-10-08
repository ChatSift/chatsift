import { startGuildSyncing } from './lib/client.js';
import { gateway } from './lib/gateway.js';

export async function bin(): Promise<void> {
	await gateway.connect();
	startGuildSyncing();
}
