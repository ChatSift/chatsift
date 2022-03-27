/*
  Warnings:

  - You are about to drop the `MessageReporter` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReportedMessage` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "MessageReporter" DROP CONSTRAINT "MessageReporter_message_id_fkey";

-- DropTable
DROP TABLE "MessageReporter";

-- DropTable
DROP TABLE "ReportedMessage";

-- CreateTable
CREATE TABLE "PresetReportReason" (
    "reportReasonId" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "PresetReportReason_pkey" PRIMARY KEY ("reportReasonId")
);

-- CreateTable
CREATE TABLE "Reporter" (
    "reportId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reporterTag" TEXT NOT NULL,

    CONSTRAINT "Reporter_pkey" PRIMARY KEY ("reportId","reporterId")
);

-- CreateTable
CREATE TABLE "Report" (
    "reportId" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT,
    "reportMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("reportId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Report_messageId_key" ON "Report"("messageId");

-- AddForeignKey
ALTER TABLE "Reporter" ADD CONSTRAINT "Reporter_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("reportId") ON DELETE CASCADE ON UPDATE CASCADE;
