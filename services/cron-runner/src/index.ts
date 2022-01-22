import 'reflect-metadata';
import { Case, CaseAction, GuildSettings, UnmuteRole } from '@automoderator/core';
import { initConfig } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import { RESTPatchAPIGuildMemberJSONBody, Routes } from 'discord-api-types/v9';
import postgres from 'postgres';

const config = initConfig();
const logger = createLogger('cron-runner');

const discordRest = new DiscordRest(config.discordToken, {
	bucket: ProxyBucket,
	domain: config.discordProxyUrl,
	retries: 1,
});

const sql = postgres(config.dbUrl, {
	onnotice: (notice) => logger.debug({ notice }, 'Database notice'),
});

// Every 1 hour, clear sigs that have been un-used for a week
setInterval(
	() =>
		void sql`DELETE FROM sigs WHERE EXTRACT (days FROM NOW() - last_used_at) >= 7`
			.then(() => logger.trace('Successfully cleared unused sigs'))
			.catch((error: unknown) => logger.error({ error }, 'Failed to clear sigs')),
	36e5,
);

const handleCase = async (cs: Case, settings: GuildSettings) => {
	switch (cs.action_type) {
		case CaseAction.mute: {
			if (!settings.mute_role) {
				return;
			}

			const roles = await sql<
				Pick<UnmuteRole, 'role_id'>[]
			>`SELECT role_id FROM unmute_roles WHERE case_id = ${cs.id}`.then((rows) => rows.map((row) => row.role_id));

			await discordRest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(cs.guild_id, cs.target_id), {
				data: { roles },
				reason: 'Automatic unmute',
			});

			await sql`DELETE FROM unmute_roles WHERE case_id = ${cs.id}`;

			break;
		}

		case CaseAction.ban: {
			await discordRest.delete(Routes.guildBan(cs.guild_id, cs.target_id), { reason: 'Automatic unban' });
			break;
		}

		default: {
			logger.warn({ cs }, 'Case had an unexpected type');
			break;
		}
	}

	await sql`UPDATE cases SET processed = true WHERE id = ${cs.id}`;
};

const handleCases = async () => {
	const cases = await sql<Case[]>`SELECT * FROM cases WHERE processed = false AND NOW() >= expires_at`;

	if (!cases.length) {
		return;
	}

	const [settings] = await sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${cases[0]!.guild_id}`;
	if (!settings) {
		return;
	}

	const promises = cases.map((cs) => handleCase(cs, settings));
	for (const promise of await Promise.allSettled(promises)) {
		if (promise.status === 'rejected') {
			logger.error({ error: promise.reason as unknown }, 'Failed to clean up a case');
		}
	}
};

// Every 1 minute, check for pending unmutes/unbans
setInterval(
	() =>
		void handleCases()
			.then(() => logger.trace('Successfully cleaned up cases'))
			.catch((error: unknown) => logger.error({ error }, 'Failed to clean up cases')),
	6e4,
);

const autoPardonWarns = async () => {
	const settings = await sql<Pick<GuildSettings, 'guild_id' | 'auto_pardon_warns_after'>[]>`
    SELECT guild_id, auto_pardon_warns_after FROM guild_settings
  `;

	const promises = settings.map(({ guild_id, auto_pardon_warns_after }) => {
		if (!auto_pardon_warns_after) {
			return Promise.resolve();
		}

		return sql`
      UPDATE cases SET pardoned_by = ${config.discordClientId}
      WHERE guild_id = ${guild_id}
        AND pardoned_by IS NULL
        AND EXTRACT (days FROM NOW() - created_at) >= ${auto_pardon_warns_after}
    `;
	});

	for (const promise of await Promise.allSettled(promises)) {
		if (promise.status === 'rejected') {
			logger.error({ error: promise.reason as unknown }, 'Failed to clean up warnings for a particular guild');
		}
	}
};

// Every 1 hour, check for warn auto pardons
setInterval(
	() =>
		void autoPardonWarns()
			.then(() => logger.trace('Successfully pardoned warns'))
			.catch((error: unknown) => logger.error({ error }, 'Failed to pardon warnings')),
	36e5,
);

const deescalateAutomodTriggers = async () => {
	const settings = await sql<GuildSettings[]>`SELECT * from guild_settings`;

	const promises = settings.map(({ guild_id, automod_cooldown }) => {
		if (!automod_cooldown) {
			return Promise.resolve();
		}

		return sql`
      UPDATE automod_triggers SET count = previous_automod_trigger(${guild_id}, user_id)
      WHERE guild_id = ${guild_id}
        AND EXTRACT (minutes FROM NOW() - created_at) >= ${automod_cooldown}
    `;
	});

	for (const promise of await Promise.allSettled(promises)) {
		if (promise.status === 'rejected') {
			logger.error({ error: promise.reason as unknown }, 'Failed to de-escalate for a particular guild');
		}
	}
};

// Every 30 seconds, check for automod de-escalations
setInterval(
	() =>
		void deescalateAutomodTriggers()
			.then(() => logger.trace('Successfully de-escalated triggers'))
			.catch((error: unknown) => logger.error({ error }, 'Failed to de-escalate automod triggers')),
	3e4,
);
