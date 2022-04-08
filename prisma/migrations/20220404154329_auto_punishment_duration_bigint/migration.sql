-- AlterTable
ALTER TABLE "BannedWord" ALTER COLUMN "duration" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "automod_punishments" ALTER COLUMN "duration" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "cases" DROP COLUMN "processed";

-- AlterTable
ALTER TABLE "warn_punishments" ALTER COLUMN "duration" SET DATA TYPE BIGINT;
