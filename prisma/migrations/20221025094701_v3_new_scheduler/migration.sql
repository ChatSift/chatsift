/*
  Warnings:

  - You are about to drop the `timed_case_tasks` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `data` to the `tasks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `tasks` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('timedModAction');

-- DropForeignKey
ALTER TABLE "timed_case_tasks" DROP CONSTRAINT "timed_case_tasks_case_id_fkey";

-- DropForeignKey
ALTER TABLE "timed_case_tasks" DROP CONSTRAINT "timed_case_tasks_task_id_fkey";

DELETE FROM "tasks";

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "data" JSONB NOT NULL,
ADD COLUMN     "type" "TaskType" NOT NULL;

-- DropTable
DROP TABLE "timed_case_tasks";
