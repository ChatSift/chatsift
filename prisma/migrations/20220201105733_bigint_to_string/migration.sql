/*
  Warnings:

  - The primary key for the `AllowedInvite` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `AllowedUrl` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `BannedWord` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `FilterIgnore` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `FilterTrigger` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `LogIgnore` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `MessageReporter` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `ReportedMessage` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `app_guilds` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `automod_punishments` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `automod_triggers` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `guild_settings` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `self_assignable_roles` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `unmute_roles` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `warn_punishments` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `webhook_tokens` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "MessageReporter" DROP CONSTRAINT "MessageReporter_message_id_fkey";

-- AlterTable
ALTER TABLE "AllowedInvite" DROP CONSTRAINT "AllowedInvite_pkey",
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ALTER COLUMN "allowed_guild_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "AllowedInvite_pkey" PRIMARY KEY ("guild_id", "allowed_guild_id");

-- AlterTable
ALTER TABLE "AllowedUrl" DROP CONSTRAINT "AllowedUrl_pkey",
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "AllowedUrl_pkey" PRIMARY KEY ("guild_id", "domain");

-- AlterTable
ALTER TABLE "BannedWord" DROP CONSTRAINT "BannedWord_pkey",
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "BannedWord_pkey" PRIMARY KEY ("guild_id", "word");

-- AlterTable
ALTER TABLE "FilterIgnore" DROP CONSTRAINT "FilterIgnore_pkey",
ALTER COLUMN "channel_id" SET DATA TYPE TEXT,
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "FilterIgnore_pkey" PRIMARY KEY ("channel_id");

-- AlterTable
ALTER TABLE "FilterTrigger" DROP CONSTRAINT "FilterTrigger_pkey",
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "FilterTrigger_pkey" PRIMARY KEY ("guild_id", "user_id");

-- AlterTable
ALTER TABLE "LogIgnore" DROP CONSTRAINT "LogIgnore_pkey",
ALTER COLUMN "channel_id" SET DATA TYPE TEXT,
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "LogIgnore_pkey" PRIMARY KEY ("channel_id");

-- AlterTable
ALTER TABLE "MessageReporter" DROP CONSTRAINT "MessageReporter_pkey",
ALTER COLUMN "message_id" SET DATA TYPE TEXT,
ALTER COLUMN "reporter_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "MessageReporter_pkey" PRIMARY KEY ("message_id", "reporter_id");

-- AlterTable
ALTER TABLE "ReportedMessage" DROP CONSTRAINT "ReportedMessage_pkey",
ALTER COLUMN "message_id" SET DATA TYPE TEXT,
ALTER COLUMN "report_message_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "ReportedMessage_pkey" PRIMARY KEY ("message_id");

-- AlterTable
ALTER TABLE "app_guilds" DROP CONSTRAINT "app_guilds_pkey",
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "app_guilds_pkey" PRIMARY KEY ("app_id", "guild_id");

-- AlterTable
ALTER TABLE "automod_punishments" DROP CONSTRAINT "automod_punishments_pkey",
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "automod_punishments_pkey" PRIMARY KEY ("guild_id", "triggers");

-- AlterTable
ALTER TABLE "automod_triggers" DROP CONSTRAINT "automod_triggers_pkey",
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "automod_triggers_pkey" PRIMARY KEY ("guild_id", "user_id");

-- AlterTable
ALTER TABLE "cases" ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ALTER COLUMN "log_message_id" SET DATA TYPE TEXT,
ALTER COLUMN "target_id" SET DATA TYPE TEXT,
ALTER COLUMN "mod_id" SET DATA TYPE TEXT,
ALTER COLUMN "pardoned_by" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "guild_settings" DROP CONSTRAINT "guild_settings_pkey",
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ALTER COLUMN "mod_role" SET DATA TYPE TEXT,
ALTER COLUMN "admin_role" SET DATA TYPE TEXT,
ALTER COLUMN "mute_role" SET DATA TYPE TEXT,
ALTER COLUMN "mod_action_log_channel" SET DATA TYPE TEXT,
ALTER COLUMN "filter_trigger_log_channel" SET DATA TYPE TEXT,
ALTER COLUMN "user_update_log_channel" SET DATA TYPE TEXT,
ALTER COLUMN "message_update_log_channel" SET DATA TYPE TEXT,
ALTER COLUMN "reports_channel" SET DATA TYPE TEXT,
ADD CONSTRAINT "guild_settings_pkey" PRIMARY KEY ("guild_id");

-- AlterTable
ALTER TABLE "self_assignable_roles" DROP CONSTRAINT "self_assignable_roles_pkey",
ALTER COLUMN "role_id" SET DATA TYPE TEXT,
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ALTER COLUMN "emoji_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "self_assignable_roles_pkey" PRIMARY KEY ("role_id", "prompt_id");

-- AlterTable
ALTER TABLE "self_assignable_roles_prompts" ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ALTER COLUMN "channel_id" SET DATA TYPE TEXT,
ALTER COLUMN "message_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "unmute_roles" DROP CONSTRAINT "unmute_roles_pkey",
ALTER COLUMN "role_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "unmute_roles_pkey" PRIMARY KEY ("case_id", "role_id");

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("user_id");

-- AlterTable
ALTER TABLE "warn_punishments" DROP CONSTRAINT "warn_punishments_pkey",
ALTER COLUMN "guild_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "warn_punishments_pkey" PRIMARY KEY ("guild_id", "warns");

-- AlterTable
ALTER TABLE "webhook_tokens" DROP CONSTRAINT "webhook_tokens_pkey",
ALTER COLUMN "channel_id" SET DATA TYPE TEXT,
ALTER COLUMN "webhook_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "webhook_tokens_pkey" PRIMARY KEY ("channel_id");

-- AddForeignKey
ALTER TABLE "MessageReporter" ADD CONSTRAINT "MessageReporter_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ReportedMessage"("message_id") ON DELETE CASCADE ON UPDATE NO ACTION;
