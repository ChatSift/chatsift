-- CreateEnum
CREATE TYPE "ModCaseKind" AS ENUM ('Warn', 'Timeout', 'Kick', 'Ban', 'Untimeout', 'Unban');

-- CreateEnum
CREATE TYPE "LogWebhookKind" AS ENUM ('Mod');

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
CREATE TABLE "Incident" (
    "id" SERIAL NOT NULL,
    "stack" TEXT NOT NULL,
    "causeStack" TEXT,
    "guildId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModCase" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" "ModCaseKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "modId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "ModCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseReference" (
    "referencedById" INTEGER NOT NULL,
    "referencesId" INTEGER NOT NULL,

    CONSTRAINT "CaseReference_pkey" PRIMARY KEY ("referencedById","referencesId")
);

-- CreateTable
CREATE TABLE "ModCaseLogMessage" (
    "caseId" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "ModCaseLogMessage_pkey" PRIMARY KEY ("caseId")
);

-- CreateTable
CREATE TABLE "LogWebhook" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "webhookToken" TEXT NOT NULL,
    "threadId" TEXT,
    "kind" "LogWebhookKind" NOT NULL,

    CONSTRAINT "LogWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordOAuth2User" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordOAuth2User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentOverride_guildId_experimentName_key" ON "ExperimentOverride"("guildId", "experimentName");

-- AddForeignKey
ALTER TABLE "ExperimentOverride" ADD CONSTRAINT "ExperimentOverride_experimentName_fkey" FOREIGN KEY ("experimentName") REFERENCES "Experiment"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReference" ADD CONSTRAINT "CaseReference_referencedById_fkey" FOREIGN KEY ("referencedById") REFERENCES "ModCase"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReference" ADD CONSTRAINT "CaseReference_referencesId_fkey" FOREIGN KEY ("referencesId") REFERENCES "ModCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModCaseLogMessage" ADD CONSTRAINT "ModCaseLogMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
