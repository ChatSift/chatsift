import type { GatewayDispatchEvents, GatewayDispatchPayload, GatewaySendPayload } from '@discordjs/core';

type _DiscordGatewayEventsMap = {
	[K in GatewayDispatchEvents]: GatewayDispatchPayload & {
		t: K;
	};
};

export type DiscordGatewayEventsMap = {
	[K in keyof _DiscordGatewayEventsMap]: _DiscordGatewayEventsMap[K]['d'];
} & {
	send: {
		payload: GatewaySendPayload;
		shardId?: number;
	};
};
