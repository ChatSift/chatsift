CREATE TYPE "AutomodPunishmentAction" AS ENUM ('warn', 'mute', 'kick', 'ban');
CREATE TYPE "WarnPunishmentAction" AS ENUM ('mute', 'kick', 'ban');

ALTER TABLE "automod_punishments"
ALTER COLUMN "action_type"
  SET DATA TYPE "AutomodPunishmentAction"
  USING CASE
    WHEN action_type = 0 THEN 'warn'::"AutomodPunishmentAction"
    WHEN action_type = 1 THEN 'mute'::"AutomodPunishmentAction"
    WHEN action_type = 2 THEN 'kick'::"AutomodPunishmentAction"
    WHEN action_type = 3 THEN 'ban'::"AutomodPunishmentAction"
  END;

ALTER TABLE "warn_punishments"
ALTER COLUMN "action_type"
  SET DATA TYPE "WarnPunishmentAction"
  USING CASE
    WHEN action_type = 0 THEN 'mute'::"WarnPunishmentAction"
    WHEN action_type = 1 THEN 'kick'::"WarnPunishmentAction"
    WHEN action_type = 2 THEN 'ban'::"WarnPunishmentAction"
  END;
