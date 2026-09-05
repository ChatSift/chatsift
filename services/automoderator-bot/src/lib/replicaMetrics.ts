import { getOwnedShardCount, getReplicaIndex } from '@chatsift/bot-core';
import { Gauge } from 'prom-client';
import { register } from './metrics.js';

/**
 * Where this process sits in the replica cluster (P8).
 *
 * These are the two gauges docs/roadmap/12-horizontal-scaling.md parked on "when bots gain a registry" --
 * AutoModerator is the first bot with one and the first to opt into scaling, so they land here. Prometheus
 * scrapes this job through `dns_sd`, which is one target per replica, so they answer what the boot log can only
 * answer per container: `sum(automoderator_shards_owned)` is the cluster's shard coverage, and a replica reading
 * above `AUTOMODERATOR_SHARDS_PER_REPLICA` is covering for a missing peer.
 *
 * **Their own module rather than `metrics.ts`, and registered from `index.ts` rather than on import.** These are
 * the only metrics that need `bot-core`, and `metrics.ts` is imported by almost every file in this service --
 * putting the import there would make `bot-core` a transitive dependency of all of them, which is both wrong and
 * enough to break test suites that mock `@chatsift/backend-core` partially.
 *
 * Read at scrape time rather than set once because the replica slot is claimed inside `createBotGateway`, before
 * `bin()` runs -- a `set()` at registration would record zero forever. Coverage cannot change afterwards without
 * the process exiting (`@discordjs/ws` cannot reshard a live manager), so a scrape-time read is exact rather than
 * merely current.
 */
export function registerReplicaMetrics(): void {
	new Gauge({
		name: 'automoderator_replica_index',
		help: 'The replica slot this process claimed',
		registers: [register],
		collect() {
			this.set(getReplicaIndex());
		},
	});

	new Gauge({
		name: 'automoderator_shards_owned',
		help: 'Gateway shards this replica is running',
		registers: [register],
		collect() {
			this.set(getOwnedShardCount());
		},
	});
}
