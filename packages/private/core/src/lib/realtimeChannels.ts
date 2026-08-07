/**
 * Channel-name builders for the WebSocket gateway (`services/api/src/ws`). A channel is an opaque string
 * both sides agree on -- built here once so the API (broadcasting) and the dashboard (subscribing) can never
 * drift out of sync on the exact string, the same "one source of truth" reasoning as the route contracts
 * (docs/adr/0001-api-contract-pattern.md).
 *
 * Format is `<domain>:<guildId>:<...>` -- the gateway's own authorization check only ever reads the second
 * colon-segment as a guild id (see `services/api/src/ws/server.ts`), so any new builder added here must keep
 * that shape.
 */
export function amaQuestionsChannel(guildId: string, amaId: number | string): string {
	return `ama-questions:${guildId}:${amaId}`;
}
