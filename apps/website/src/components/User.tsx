'use client';

import { CDNRoutes, ImageFormat, RouteBases, type DefaultUserAvatarAssets } from 'discord-api-types/v10';
import { Avatar, AvatarImage } from '~/components/Avatar';
import Button from '~/components/Button';
import Skeleton from '~/components/Skeleton';
import { useUser, type CurrentUserResult } from '~/hooks/useUser';
import { URLS } from '~/util/constants';
import { APIError } from '~/util/fetcher';

function ErrorHandler({ error }: { readonly error: Error }) {
	if (error instanceof APIError && error.payload.statusCode === 401) {
		return (
			<Button>
				<a href={URLS.API.LOGIN}>Log in</a>
			</Button>
		);
	}

	return <>Error</>;
}

interface UserAvatarProps {
	readonly className: string;
	readonly isLoading: boolean;
	readonly user: CurrentUserResult | undefined;
}

function UserAvatar({ isLoading, user, className }: UserAvatarProps) {
	const avatarUrl = user?.avatar
		? `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}`
		: `${RouteBases.cdn}${CDNRoutes.defaultUserAvatar(Number((BigInt(user?.id ?? '0') >> 22n) % 6n) as DefaultUserAvatarAssets)}`;

	return (
		<Avatar className={className}>
			{isLoading ? <Skeleton className={className} /> : <AvatarImage src={avatarUrl} className={className} />}
		</Avatar>
	);
}

export function UserDesktop() {
	const { isLoading, data: user, error } = useUser();

	if (error) {
		return <ErrorHandler error={error} />;
	}

	return (
		<>
			<Button>
				<a href={URLS.API.LOGOUT}>Log out</a>
			</Button>
			<UserAvatar user={user} isLoading={isLoading} className="h-12 w-12 rounded-full" />
		</>
	);
}

export function UserMobile() {
	const { isLoading, data: user, error } = useUser();

	if (error) {
		return <ErrorHandler error={error} />;
	}

	return (
		<div className="flex flex-row items-center gap-4">
			<UserAvatar user={user} isLoading={isLoading} className="h-8 w-8 rounded-full" />
			<p className="text-base font-medium">{user?.username}</p>
			<Button className="ml-auto">
				<a href={URLS.API.LOGOUT} className="text-secondary dark:text-secondary-dark">
					Log out
				</a>
			</Button>
		</div>
	);
}
