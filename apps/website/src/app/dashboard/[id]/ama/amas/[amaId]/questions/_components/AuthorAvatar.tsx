import type { APIUser, Snowflake } from 'discord-api-types/v10';
import { userLabel } from './userLabel';
import { DiscordUserAvatar } from '@/components/common/DiscordUserAvatar';

interface AuthorAvatarProps {
	readonly className?: string;
	readonly user: APIUser | Snowflake;
}

/**
 * An AMA question author's avatar. Only AMA's own labelling — `userLabel` — is left here; the CDN url arithmetic
 * moved to `DiscordUserAvatar` once the AutoModerator report detail needed the same thing.
 */
export function AuthorAvatar({ user, className = 'h-6 w-6 rounded-full' }: AuthorAvatarProps) {
	return <DiscordUserAvatar className={className} initials={userLabel(user).slice(0, 2)} user={user} />;
}
