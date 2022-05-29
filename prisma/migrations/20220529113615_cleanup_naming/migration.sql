/*
  Warnings:

  - You are about to drop the column `id` on the `self_assignable_roles` table. All the data in the column will be lost.
  - You are about to drop the `AllowedInvite` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AllowedUrl` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BannedWord` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FilterIgnore` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FilterTrigger` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LogIgnore` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MaliciousFile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MaliciousUrl` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PresetReportReason` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Report` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Reporter` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Task` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TimedCaseTask` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Reporter" DROP CONSTRAINT "Reporter_reportId_fkey";

-- DropForeignKey
ALTER TABLE "TimedCaseTask" DROP CONSTRAINT "TimedCaseTask_caseId_fkey";

-- DropForeignKey
ALTER TABLE "TimedCaseTask" DROP CONSTRAINT "TimedCaseTask_taskId_fkey";

-- AlterTable
ALTER TABLE "self_assignable_roles" DROP CONSTRAINT "self_assignable_roles_pkey",
DROP COLUMN "id",
ADD CONSTRAINT "self_assignable_roles_pkey" PRIMARY KEY ("role_id", "prompt_id");

ALTER TABLE "AllowedInvite" RENAME TO "allowed_invites";
ALTER TABLE "AllowedUrl" RENAME TO "allowed_urls";
ALTER TABLE "BannedWord" RENAME to "banned_words";
ALTER TABLE "FilterIgnore" RENAME TO "filter_ignores";
ALTER TABLE "FilterTrigger" RENAME TO "filter_triggers";
ALTER TABLE "LogIgnore" RENAME TO "log_ignores";
ALTER TABLE "MaliciousFile" RENAME TO "malicious_files";
ALTER TABLE "MaliciousUrl" RENAME TO "malicious_urls";
ALTER TABLE "PresetReportReason" RENAME TO "preset_report_reasons";
ALTER TABLE "Report" RENAME TO "reports";
ALTER TABLE "Reporter" RENAME TO "reporters";
ALTER TABLE "Task" RENAME TO "tasks";
ALTER TABLE "TimedCaseTask" RENAME TO "timed_case_tasks";

ALTER TABLE "preset_report_reasons" RENAME COLUMN "reportReasonId" TO "report_reason_id";
ALTER TABLE "preset_report_reasons" RENAME COLUMN "guildId" TO "guild_id";
ALTER TABLE "reporters" RENAME COLUMN "reportId" TO "report_id";
ALTER TABLE "reporters" RENAME COLUMN "reporterId" TO "reporter_id";
ALTER TABLE "reporters" RENAME COLUMN "reporterTag" TO "reporter_tag";
ALTER TABLE "reports" RENAME COLUMN "reportId" TO "report_id";
ALTER TABLE "reports" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "reports" RENAME COLUMN "messageId" TO "message_id";
ALTER TABLE "reports" RENAME COLUMN "reportMessageId" TO "report_message_id";
ALTER TABLE "reports" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "reports" RENAME COLUMN "acknowledgedAt" TO "acknowledged_at";
ALTER TABLE "tasks" RENAME COLUMN "guildId" TO "guild_id";
ALTER TABLE "tasks" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "tasks" RENAME COLUMN "runAt" TO "run_at";
ALTER TABLE "timed_case_tasks" RENAME COLUMN "taskId" TO "task_id";
ALTER TABLE "timed_case_tasks" RENAME COLUMN "caseId" TO "case_id";

ALTER INDEX "MaliciousFile_file_hash_key" RENAME TO "malicious_files_file_hash_key";
ALTER INDEX "MaliciousUrl_url_key" RENAME TO "malicious_urls_url_key";
ALTER INDEX "Report_messageId_key" RENAME TO "reports_message_id_key";
ALTER INDEX "TimedCaseTask_caseId_key" RENAME TO "timed_case_tasks_case_id_key";

ALTER TABLE "reporters" ADD CONSTRAINT "reporters_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timed_case_tasks" ADD CONSTRAINT "timed_case_tasks_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "timed_case_tasks" ADD CONSTRAINT "timed_case_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "allowed_invites" RENAME CONSTRAINT "AllowedInvite_pkey" TO "allowed_invites_pkey";
ALTER TABLE "allowed_urls" RENAME CONSTRAINT "AllowedUrl_pkey" TO "allowed_urls_pkey";
ALTER TABLE "banned_words" RENAME CONSTRAINT "BannedWord_pkey" TO "banned_words_pkey";
ALTER TABLE "filter_ignores" RENAME CONSTRAINT "FilterIgnore_pkey" TO "filter_ignores_pkey";
ALTER TABLE "filter_triggers" RENAME CONSTRAINT "FilterTrigger_pkey" TO "filter_triggers_pkey";
ALTER TABLE "log_ignores" RENAME CONSTRAINT "LogIgnore_pkey" TO "log_ignores_pkey";
ALTER TABLE "malicious_files" RENAME CONSTRAINT "MaliciousFile_pkey" TO "malicious_files_pkey";
ALTER TABLE "malicious_urls" RENAME CONSTRAINT "MaliciousUrl_pkey" TO "malicious_urls_pkey";
ALTER TABLE "preset_report_reasons" RENAME CONSTRAINT "PresetReportReason_pkey" TO "preset_report_reasons_pkey";
ALTER TABLE "reporters" RENAME CONSTRAINT "Reporter_pkey" TO "reporters_pkey";
ALTER TABLE "reports" RENAME CONSTRAINT "Report_pkey" TO "reports_pkey";
ALTER TABLE "tasks" RENAME CONSTRAINT "Task_pkey" TO "tasks_pkey";
ALTER TABLE "timed_case_tasks" RENAME CONSTRAINT "TimedCaseTask_pkey" TO "timed_case_tasks_pkey";
