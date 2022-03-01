/*
  Warnings:

  - The primary key for the `webhook_tokens` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `channel_id` on the `webhook_tokens` table. All the data in the column will be lost.
  - Added the required column `guild_id` to the `webhook_tokens` table without a default value. This is not possible if the table is not empty.
  - Added the required column `log_type` to the `webhook_tokens` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "LogChannelType" AS ENUM ('mod', 'filter', 'user', 'message');

-- AlterTable
ALTER TABLE "webhook_tokens" DROP CONSTRAINT "webhook_tokens_pkey",
DROP COLUMN "channel_id",
ADD COLUMN     "guild_id" TEXT NOT NULL,
ADD COLUMN     "log_type" "LogChannelType" NOT NULL,
ADD COLUMN     "thread_id" TEXT,
ADD CONSTRAINT "webhook_tokens_pkey" PRIMARY KEY ("guild_id", "log_type");
