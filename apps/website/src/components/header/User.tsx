'use client';

import type { UserMe } from '@chatsift/shared';
import { CDNRoutes, ImageFormat, RouteBases, type DefaultUserAvatarAssets } from 'discord-api-types/v10';
import { Avatar, AvatarImage } from '~/components/common/Avatar';
import Button from '~/components/common/Button';
import Skeleton from '~/components/common/Skeleton';
import { client } from '~/data/client';
import { URLS } from '~/util/constants';
import { APIError } from '~/util/fetcher';

function LoginButton() {
	return (
		<Button>
			<a href={URLS.API.LOGIN}>Log in</a>
		</Button>
	);
}

function ErrorHandler({ error }: { readonly error: Error }) {
	if (error instanceof APIError && error.payload.statusCode === 401) {
		return <LoginButton />;
	}

	return <>Error</>;
}

interface UserAvatarProps {
	readonly className: string;
	readonly isLoading: boolean;
	readonly user: UserMe | undefined;
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
	const { isLoading, data: user, error } = client.useMe();

	if (error) {
		return <ErrorHandler error={error} />;
	}

	// As always, null implies pre-fetch came back empty with a 401
	return user ? (
		<>
			<Button>
				<a href={URLS.API.LOGOUT}>Log out</a>
			</Button>
			<UserAvatar user={user} isLoading={isLoading} className="h-12 w-12 rounded-full" />
		</>
	) : (
		<LoginButton />
	);
}

export function UserMobile() {
	const { isLoading, data: user, error } = client.useMe();

	if (error) {
		return <ErrorHandler error={error} />;
	}

	return user ? (
		<div className="flex flex-row items-center gap-4">
			<UserAvatar user={user} isLoading={isLoading} className="h-8 w-8 rounded-full" />
			<p className="text-base font-medium">{user?.username}</p>
			<Button className="ml-auto">
				<a href={URLS.API.LOGOUT} className="text-secondary">
					Log out
				</a>
			</Button>
		</div>
	) : (
		<LoginButton />
	);
}
