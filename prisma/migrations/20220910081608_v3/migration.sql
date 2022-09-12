/*
  Warnings:

  - You are about to drop the `app_guilds` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `apps` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sigs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "app_guilds" DROP CONSTRAINT "app_guilds_app_id_fkey";

-- DropForeignKey
ALTER TABLE "sigs" DROP CONSTRAINT "sigs_app_id_fkey";

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "duration" BIGINT,
ADD COLUMN     "log_channel_id" TEXT;

-- DropTable
DROP TABLE "app_guilds";

-- DropTable
DROP TABLE "apps";

-- DropTable
DROP TABLE "sigs";

-- DropTable
DROP TABLE "users";
