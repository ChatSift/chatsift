import type { GatewayDispatchEvents, GatewayDispatchPayload, GatewaySendPayload } from 'discord-api-types/v10';

type _DiscordEventsMap = {
	[K in GatewayDispatchEvents]: GatewayDispatchPayload & {
		t: K;
	};
};

export type DiscordEventsMap = {
	[K in keyof _DiscordEventsMap]: _DiscordEventsMap[K]['d'];
} & {
	send: {
		payload: GatewaySendPayload;
		shardId?: number;
	};
};
