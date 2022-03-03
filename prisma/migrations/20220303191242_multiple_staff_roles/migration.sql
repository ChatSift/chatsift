ALTER TABLE "self_assignable_roles_prompts" ALTER COLUMN "embed_title" DROP NOT NULL;

CREATE TABLE "ModRole" (
    "guild_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "ModRole_pkey" PRIMARY KEY ("role_id")
);

CREATE TABLE "AdminRole" (
    "guild_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("role_id")
);

ALTER TABLE "ModRole" ADD CONSTRAINT "ModRole_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "AdminRole" ADD CONSTRAINT "AdminRole_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION;

INSERT INTO "ModRole" ("guild_id", "role_id") SELECT "guild_id", "mod_role" FROM "guild_settings";
INSERT INTO "AdminRole" ("guild_id", "role_id") SELECT "guild_id", "admin_role" FROM "guild_settings";

ALTER TABLE "guild_settings" DROP COLUMN "admin_role", DROP COLUMN "mod_role";
