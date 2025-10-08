import { gateway } from './lib/gateway.js';

export async function bin(): Promise<void> {
	await gateway.connect();
}
