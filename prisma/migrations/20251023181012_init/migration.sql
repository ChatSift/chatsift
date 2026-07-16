-- CreateEnum
CREATE TYPE "AMAQuestionState" AS ENUM ('PENDING_MOD_REVIEW', 'PENDING_GUEST_REVIEW', 'FLAGGED', 'APPROVED', 'DENIED');

-- CreateTable
CREATE TABLE "Experiment" (
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "rangeStart" INTEGER NOT NULL,
    "rangeEnd" INTEGER NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "ExperimentOverride" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "experimentName" TEXT NOT NULL,

    CONSTRAINT "ExperimentOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardGrant" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "DashboardGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AMASession" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "modQueueId" TEXT,
    "flaggedQueueId" TEXT,
    "guestQueueId" TEXT,
    "title" TEXT NOT NULL,
    "answersChannelId" TEXT NOT NULL,
    "promptChannelId" TEXT NOT NULL,
    "allowedQuestionUploads" INTEGER NOT NULL DEFAULT 2,
    "ended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AMASession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AMAPromptData" (
    "id" SERIAL NOT NULL,
    "amaId" INTEGER NOT NULL,
    "promptMessageId" TEXT NOT NULL,
    "promptJSONData" TEXT NOT NULL,

    CONSTRAINT "AMAPromptData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AMAQuestion" (
    "id" SERIAL NOT NULL,
    "amaId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "state" "AMAQuestionState" NOT NULL DEFAULT 'PENDING_MOD_REVIEW',
    "content" TEXT NOT NULL,
    "modQueueMessageId" TEXT,
    "guestQueueMessageId" TEXT,
    "flaggedQueueMessageId" TEXT,
    "answersMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AMAQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentOverride_guildId_experimentName_key" ON "ExperimentOverride"("guildId", "experimentName");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardGrant_guildId_userId_key" ON "DashboardGrant"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AMAPromptData_amaId_key" ON "AMAPromptData"("amaId");

-- CreateIndex
CREATE UNIQUE INDEX "AMAPromptData_promptMessageId_key" ON "AMAPromptData"("promptMessageId");

-- AddForeignKey
ALTER TABLE "ExperimentOverride" ADD CONSTRAINT "ExperimentOverride_experimentName_fkey" FOREIGN KEY ("experimentName") REFERENCES "Experiment"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AMAPromptData" ADD CONSTRAINT "AMAPromptData_amaId_fkey" FOREIGN KEY ("amaId") REFERENCES "AMASession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AMAQuestion" ADD CONSTRAINT "AMAQuestion_amaId_fkey" FOREIGN KEY ("amaId") REFERENCES "AMASession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
