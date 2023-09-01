-- CreateEnum
CREATE TYPE "LogChannelType" AS ENUM ('mod', 'filter', 'user', 'message');

-- CreateEnum
CREATE TYPE "CaseAction" AS ENUM ('role', 'unrole', 'warn', 'timeout', 'revokeTimeout', 'kick', 'softban', 'ban', 'unban');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('undoTimedRoleCase');

-- CreateTable
CREATE TABLE "LogChannelWebhook" (
    "guildId" TEXT NOT NULL,
    "logType" "LogChannelType" NOT NULL,
    "channelId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "webhookToken" TEXT NOT NULL,
    "threadId" TEXT,

    CONSTRAINT "LogChannelWebhook_pkey" PRIMARY KEY ("guildId","logType")
);

-- CreateTable
CREATE TABLE "CaseReference" (
    "caseId" INTEGER NOT NULL,
    "refId" INTEGER NOT NULL,

    CONSTRAINT "CaseReference_pkey" PRIMARY KEY ("caseId","refId")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "logChannelId" TEXT,
    "logMessageId" TEXT,
    "targetId" TEXT NOT NULL,
    "modId" TEXT,
    "actionType" "CaseAction" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UndoRole" (
    "caseId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UndoRole_pkey" PRIMARY KEY ("caseId","roleId")
);

-- CreateTable
CREATE TABLE "RoleCaseData" (
    "id" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    "clean" BOOLEAN NOT NULL DEFAULT false,
    "duration" INTEGER,
    "expiresAt" TIMESTAMPTZ(6),

    CONSTRAINT "RoleCaseData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarnCaseData" (
    "id" INTEGER NOT NULL,
    "pardonedById" TEXT,

    CONSTRAINT "WarnCaseData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanCaseData" (
    "id" INTEGER NOT NULL,
    "deleteMessageDays" INTEGER,
    "duration" INTEGER,
    "expiresAt" TIMESTAMPTZ(6),

    CONSTRAINT "BanCaseData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "type" "TaskType" NOT NULL,
    "guildId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runAt" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CaseReference" ADD CONSTRAINT "CaseReference_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReference" ADD CONSTRAINT "CaseReference_refId_fkey" FOREIGN KEY ("refId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UndoRole" ADD CONSTRAINT "UndoRole_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RoleCaseData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleCaseData" ADD CONSTRAINT "RoleCaseData_id_fkey" FOREIGN KEY ("id") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarnCaseData" ADD CONSTRAINT "WarnCaseData_id_fkey" FOREIGN KEY ("id") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanCaseData" ADD CONSTRAINT "BanCaseData_id_fkey" FOREIGN KEY ("id") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
