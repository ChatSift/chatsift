import type { Case } from '@prisma/client';

export enum GuildLogType {
	AutomodTrigger = 'automod_triggers',
	ModAction = 'mod_actions',
	UserJoin = 'user_joins',
	UserLeave = 'user_leaves',
	UserNicknameUpdate = 'user_nickname_updates',
	UserUsernameUpdate = 'user_username_updates',
}

interface GuildLogBaseData {
	guildId: string;
}

export type GuildLogModActionData = GuildLogBaseData & {
	cases: Case[];
};

export interface GuildLogMap {
	[GuildLogType.ModAction]: GuildLogModActionData;
	[GuildLogType.AutomodTrigger]: never;
	[GuildLogType.UserJoin]: never;
	[GuildLogType.UserLeave]: never;
	[GuildLogType.UserUsernameUpdate]: never;
	[GuildLogType.UserNicknameUpdate]: never;
}
