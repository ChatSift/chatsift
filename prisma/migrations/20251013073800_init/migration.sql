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
CREATE TABLE "AMASession" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "modQueueId" TEXT,
    "flaggedQueueId" TEXT,
    "guestQueueId" TEXT,
    "title" TEXT NOT NULL,
    "answersChannelId" TEXT NOT NULL,
    "promptChannelId" TEXT NOT NULL,
    "promptMessageId" TEXT NOT NULL,
    "ended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AMASession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AMAQuestion" (
    "id" SERIAL NOT NULL,
    "amaId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "answerMessageId" TEXT,

    CONSTRAINT "AMAQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentOverride_guildId_experimentName_key" ON "ExperimentOverride"("guildId", "experimentName");

-- CreateIndex
CREATE UNIQUE INDEX "AMASession_promptMessageId_key" ON "AMASession"("promptMessageId");

-- AddForeignKey
ALTER TABLE "ExperimentOverride" ADD CONSTRAINT "ExperimentOverride_experimentName_fkey" FOREIGN KEY ("experimentName") REFERENCES "Experiment"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AMAQuestion" ADD CONSTRAINT "AMAQuestion_amaId_fkey" FOREIGN KEY ("amaId") REFERENCES "AMASession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
