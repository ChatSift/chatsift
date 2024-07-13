import 'reflect-metadata';
import {
	globalContainer,
	DependencyManager,
	setupCrashLogs,
	encode,
	decode,
	type DiscordGatewayEventsMap,
	INotifier,
	IDatabase,
	ModCaseKind,
} from '@automoderator/core';
import { PubSubRedisBroker } from '@discordjs/brokers';
import {
	AuditLogEvent,
	GatewayDispatchEvents,
	type GatewayGuildAuditLogEntryCreateDispatchData,
} from '@discordjs/core';
import { time } from '@discordjs/formatters';

const dependencyManager = globalContainer.get(DependencyManager);
dependencyManager.registerLogger('observer');
const redis = dependencyManager.registerRedis();
const api = dependencyManager.registerApi();

setupCrashLogs();

const notifier = globalContainer.get(INotifier);
const database = globalContainer.get(IDatabase);

const broker = new PubSubRedisBroker<DiscordGatewayEventsMap>({
	redisClient: redis,
	encode,
	decode,
});

async function handlePotentialTimeout(data: GatewayGuildAuditLogEntryCreateDispatchData): Promise<void> {
	const mod = await api.users.get(data.user_id!);
	const target = await api.users.get(data.target_id!);

	if (mod.bot || target.bot) {
		return;
	}

	const change = data.changes?.find((change) => change.key === 'communication_disabled_until');
	if (change?.new_value) {
		const modCase = await database.createModCase({
			guildId: data.guild_id,
			targetId: data.target_id!,
			modId: data.user_id!,
			reason: `${data.reason ?? 'No reason provided.'} | Until ${time(new Date(change.new_value))}`,
			kind: ModCaseKind.Timeout,
			references: [],
		});

		await notifier.tryNotifyTargetModCase(modCase);
		await notifier.logModCase({ modCase, mod, target, references: [] });
	}
}

broker.on(GatewayDispatchEvents.GuildAuditLogEntryCreate, async ({ data, ack }) => {
	if (data.action_type === AuditLogEvent.MemberUpdate) {
		await handlePotentialTimeout(data);
	}

	await ack();
});

await broker.subscribe('observer', [
	GatewayDispatchEvents.GuildMemberUpdate,
	GatewayDispatchEvents.GuildAuditLogEntryCreate,
]);
