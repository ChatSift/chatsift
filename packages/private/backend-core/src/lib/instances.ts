import { setInterval } from 'node:timers';
import type { ModmailInstances } from '@chatsift/db';
import { getContext } from './context.js';
import { decrypt } from './crypt.js';

/**
 * A decoded `modmail_instances` row -- `token` is the plaintext bot token (decrypted once here, not
 * on every read), see docs/roadmap/08-modmail-custom-instances.md.
 */
export interface Instance {
	readonly guildId: string;
	readonly id: string;
	readonly label: string;
	readonly token: string;
}

const REFRESH_INTERVAL_MS = 60_000;

let byGuildId = new Map<string, Instance>();
let selfInstance: Instance | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function decode(row: ModmailInstances): Instance {
	return { id: row.id, guildId: row.guildId, label: row.label, token: decrypt(row.token) };
}

async function fetchInstances(): Promise<Instance[]> {
	const rows = await getContext().db<ModmailInstances[]>`SELECT * FROM modmail_instances`;
	return rows.map(decode);
}

function applySnapshot(instances: Instance[]): void {
	byGuildId = new Map(instances.map((instance) => [instance.guildId, instance]));

	const selfId = getContext().env.MODMAIL_INSTANCE_ID;
	if (selfId) {
		const found = instances.find((instance) => instance.id === selfId);
		if (found) {
			selfInstance = found;
		} else {
			// Leaves the last-known good `selfInstance` in place rather than nulling it out -- a
			// transient refresh glitch (or the row briefly missing mid-edit) shouldn't make a running
			// custom deployment suddenly believe it's unowned. `loadInstances` below is the one place
			// this condition is fatal, since there's no "last known good" to fall back to on first boot.
			getContext().logger.error(
				{ instanceId: selfId },
				'MODMAIL_INSTANCE_ID does not match any modmail_instances row on refresh',
			);
		}
	}
}

/**
 * Loads the `modmail_instances` registry into an in-memory snapshot and starts a 60s background
 * refresh (`.unref()`'d, matching `@chatsift/bot-core`'s guild-list-sync interval) so the hot path
 * (`getInstanceForGuild`/`getSelfInstance`, called on effectively every outbound ModMail Discord
 * call) never does a per-call DB round trip. Call once at boot, after `initContext()`.
 *
 * Throws if `ENV.MODMAIL_INSTANCE_ID` is set but matches no row -- fatal for a custom deployment,
 * which has no meaningful way to run without knowing its own guild/token.
 */
export async function loadInstances(): Promise<void> {
	const instances = await fetchInstances();
	applySnapshot(instances);

	const selfId = getContext().env.MODMAIL_INSTANCE_ID;
	if (selfId && !selfInstance) {
		throw new Error(`MODMAIL_INSTANCE_ID "${selfId}" does not match any modmail_instances row`);
	}

	refreshTimer ??= setInterval(async () => {
		try {
			applySnapshot(await fetchInstances());
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to refresh the modmail instance registry');
		}
	}, REFRESH_INTERVAL_MS).unref();
}

/**
 * The instance that owns `guildId`, or `null` if it's served by the public deployment (no
 * `modmail_instances` row for it).
 */
export function getInstanceForGuild(guildId: string): Instance | null {
	return byGuildId.get(guildId) ?? null;
}

export function getCustomInstanceGuildIds(): ReadonlySet<string> {
	return new Set(byGuildId.keys());
}

/**
 * Every currently-known custom instance -- used by `services/api`'s `/me` guild-list union (each instance
 * publishes its own `bot:MODMAIL#<id>` redis guild list) and by anything that needs to enumerate instances
 * rather than look one up by guild (e.g. a future resync-all operation).
 */
export function getAllInstances(): Instance[] {
	return [...byGuildId.values()];
}

/**
 * This process's own instance, resolved from `ENV.MODMAIL_INSTANCE_ID` -- `null` for the public
 * deployment and for every non-bot process (the API never sets that env var), not just "not loaded
 * yet".
 */
export function getSelfInstance(): Instance | null {
	return selfInstance;
}
