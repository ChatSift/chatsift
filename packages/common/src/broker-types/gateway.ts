import type { GatewayDispatchEvents, GatewayDispatchPayload, GatewaySendPayload } from 'discord-api-types/v10';

type _DiscordEventsMap = {
	[K in GatewayDispatchEvents]: GatewayDispatchPayload & {
		t: K;
	};
};

export type DiscordEventsMap = {
	// @ts-expect-error
	[K in keyof _DiscordEventsMap]: _DiscordEventsMap[K]['d'];
} & {
	send: GatewaySendPayload;
};
