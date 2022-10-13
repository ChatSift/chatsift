-- DropForeignKey
ALTER TABLE "AdminRole" DROP CONSTRAINT "AdminRole_guild_id_fkey";

-- DropForeignKey
ALTER TABLE "ModRole" DROP CONSTRAINT "ModRole_guild_id_fkey";

-- CreateTable
CREATE TABLE "BypassRole" (
    "guild_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "BypassRole_pkey" PRIMARY KEY ("role_id")
);

-- AddForeignKey
ALTER TABLE "BypassRole" ADD CONSTRAINT "BypassRole_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION;

INSERT INTO "BypassRole" ("guild_id", "role_id") SELECT "guild_id", "role_id" FROM "AdminRole";
INSERT INTO "BypassRole" ("guild_id", "role_id") SELECT "guild_id", "role_id" FROM "ModRole";

-- DropTable
DROP TABLE "AdminRole";

-- DropTable
DROP TABLE "ModRole";
