import type { GatewayDispatchEvents, GatewayDispatchPayload, GatewaySendPayload } from 'discord-api-types/v10';

type _DiscordEventsMap = {
	[K in GatewayDispatchEvents]: GatewayDispatchPayload & {
		t: K;
	};
};

export type DiscordEventsMap = {
	// @ts-expect-error - discord-api-types currently somehow is missing payloads for some events - causing this needed ignore
	// Ref: https://github.com/discordjs/discord-api-types/issues/617#issuecomment-1286695346
	[K in keyof _DiscordEventsMap]: _DiscordEventsMap[K]['d'];
} & {
	send: GatewaySendPayload;
};
