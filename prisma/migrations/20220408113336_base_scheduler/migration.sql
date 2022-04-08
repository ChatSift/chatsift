-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runAt" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimedCaseTask" (
    "taskId" INTEGER NOT NULL,
    "caseId" INTEGER NOT NULL,

    CONSTRAINT "TimedCaseTask_pkey" PRIMARY KEY ("taskId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimedCaseTask_caseId_key" ON "TimedCaseTask"("caseId");

-- AddForeignKey
ALTER TABLE "TimedCaseTask" ADD CONSTRAINT "TimedCaseTask_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TimedCaseTask" ADD CONSTRAINT "TimedCaseTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
