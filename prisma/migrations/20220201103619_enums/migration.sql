/*
  Warnings:

  - Changed the type of `category` on the `MaliciousFile` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `category` on the `MaliciousUrl` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `action_type` on the `cases` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "CaseAction" AS ENUM ('warn', 'mute', 'unmute', 'kick', 'softban', 'ban', 'unban');
CREATE TYPE "MaliciousFileCategory" AS ENUM ('nsfw', 'gore', 'shock', 'crasher');
CREATE TYPE "MaliciousUrlCategory" AS ENUM ('malicious', 'phishing', 'scam', 'spam', 'shock', 'deceptive', 'urlShortner');

ALTER TABLE "cases"
ALTER COLUMN "action_type"
  SET DATA TYPE "CaseAction"
  USING CASE
    WHEN action_type = 0 THEN 'warn'::"CaseAction"
    WHEN action_type = 1 THEN 'mute'::"CaseAction"
    WHEN action_type = 2 THEN 'unmute'::"CaseAction"
    WHEN action_type = 3 THEN 'kick'::"CaseAction"
    WHEN action_type = 4 THEN 'softban'::"CaseAction"
    WHEN action_type = 5 THEN 'ban'::"CaseAction"
    WHEN action_type = 6 THEN 'unban'::"CaseAction"
  END;

ALTER TABLE "MaliciousFile"
ALTER COLUMN "category"
  SET DATA TYPE "MaliciousFileCategory"
  USING CASE
    WHEN category = 0 THEN 'nsfw'::"MaliciousFileCategory"
    WHEN category = 1 THEN 'gore'::"MaliciousFileCategory"
    WHEN category = 2 THEN 'shock'::"MaliciousFileCategory"
    WHEN category = 3 THEN 'crasher'::"MaliciousFileCategory"
  END;

ALTER TABLE "MaliciousUrl"
ALTER COLUMN "category"
  SET DATA TYPE "MaliciousUrlCategory"
  USING CASE
    WHEN category = 0 THEN 'malicious'::"MaliciousUrlCategory"
    WHEN category = 1 THEN 'phishing'::"MaliciousUrlCategory"
    WHEN category = 2 THEN 'scam'::"MaliciousUrlCategory"
    WHEN category = 3 THEN 'spam'::"MaliciousUrlCategory"
    WHEN category = 4 THEN 'shock'::"MaliciousUrlCategory"
    WHEN category = 5 THEN 'deceptive'::"MaliciousUrlCategory"
    WHEN category = 6 THEN 'urlShortner'::"MaliciousUrlCategory"
  END;
