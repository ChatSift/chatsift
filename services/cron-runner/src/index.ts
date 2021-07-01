import 'reflect-metadata';
import postgres from 'postgres';
import createLogger from '@automoderator/logger';
import { initConfig } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { Case, CaseAction, GuildSettings, UnmuteRole } from '@automoderator/core';
import { RESTPatchAPIGuildMemberJSONBody, Routes } from 'discord-api-types/v8';

const config = initConfig();
const logger = createLogger('CRON-RUNNER');

const discordRest = new DiscordRest(config.discordToken);

const sql = postgres(config.dbUrl, {
  onnotice: notice => logger.debug({ topic: 'DB NOTICE', notice })
});

// Every 1 hour, clear sigs that have been un-used for a week
setInterval(
  () => void sql`DELETE FROM sigs WHERE EXTRACT (days FROM NOW() - last_used_at) >= 7`
    .then(() => logger.info('Successfully cleared unused sigs'))
    .catch(error => logger.error({ error }, 'Failed to clear sigs')),
  36e5
);

const handleCase = async (cs: Case, settings: GuildSettings) => {
  switch (cs.action_type) {
    case CaseAction.mute: {
      if (!settings.mute_role) {
        return;
      }

      const roles = await sql<Pick<UnmuteRole, 'role_id'>[]>`SELECT role_id FROM unmute_roles WHERE case_id = ${cs.id}`
        .then(
          rows => rows.map(
            row => row.role_id
          )
        );

      await discordRest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(cs.guild_id, cs.target_id), {
        data: { roles },
        reason: 'Automatic unmute'
      });

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
  const cases = await sql<Case[]>`SELECT * FROM cases WHERE processed = false AND expires_at >= NOW()`;

  if (!cases.length) {
    return;
  }

  const [settings] = await sql<[GuildSettings?]>`SELECT * FROM settings WHERE guild_id = ${cases[0]!.guild_id}`;
  if (!settings) {
    return;
  }

  const promises = cases.map(cs => handleCase(cs, settings));
  for (const promise of await Promise.allSettled(promises)) {
    if (promise.status === 'rejected') {
      logger.error({ error: promise.reason }, 'Failed to clean up a case');
    }
  }
};

// Every 1 minute, check for pending unmutes/unbans
setInterval(
  () => void handleCases()
    .then(() => logger.info('Successfully cleaned up cases'))
    .catch(error => logger.error({ error }, 'Failed to clean up cases')),
  36e2
);
