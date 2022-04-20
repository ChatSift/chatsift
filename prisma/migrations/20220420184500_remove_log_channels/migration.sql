/*
  Warnings:

  - You are about to drop the column `filter_trigger_log_channel` on the `guild_settings` table. All the data in the column will be lost.
  - You are about to drop the column `message_update_log_channel` on the `guild_settings` table. All the data in the column will be lost.
  - You are about to drop the column `mod_action_log_channel` on the `guild_settings` table. All the data in the column will be lost.
  - You are about to drop the column `user_update_log_channel` on the `guild_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "guild_settings" DROP COLUMN "filter_trigger_log_channel",
DROP COLUMN "message_update_log_channel",
DROP COLUMN "mod_action_log_channel",
DROP COLUMN "user_update_log_channel";
