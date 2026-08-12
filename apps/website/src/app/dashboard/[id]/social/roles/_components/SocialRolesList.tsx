'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { GuildRoleInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import type { SocialRole } from '@/api/routes/social';
import { useDeleteSocialRole, useSocialRoles } from '@/api/routes/social';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgPlus } from '@/components/icons/SvgPlus';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

interface SocialRoleCardProps {
	readonly guildId: string;
	readonly role: SocialRole;
	/**
	 * The role as Discord currently has it, or `undefined` once it's been deleted there -- the row outlives it,
	 * and the card still has to be removable.
	 */
	readonly roleInfo: GuildRoleInfo | undefined;
}

function SocialRoleCard({ guildId, role, roleInfo }: SocialRoleCardProps) {
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deleteRole = useDeleteSocialRole(guildId);
	const label = roleInfo ? `@${roleInfo.name}` : `Deleted role (${role.roleId})`;

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-semibold text-primary dark:text-primary-dark">
				{label}
			</p>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				{role.multiplier === 1 ? 'No multiplier -- normal XP' : `${role.multiplier}x XP`}
			</p>

			<div className="mt-auto flex justify-end gap-2">
				<Link
					className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
					href={`/dashboard/${guildId}/social/roles/${role.roleId}`}
				>
					Edit
				</Link>
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Remove</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Remove"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deleteRole.mutateAsync(role.roleId)}
				onOpenChange={setIsConfirmOpen}
				title={`Remove ${label}?`}
			>
				Members holding {label} go back to earning normal XP. Nobody loses the XP they&apos;ve already earned, and the
				role itself is left alone on Discord.
			</ConfirmModal>
		</div>
	);
}

function AddRoleCard({ guildId }: { readonly guildId: string }) {
	return (
		<Link
			className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 self-stretch rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark"
			href={`/dashboard/${guildId}/social/roles/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Add Role</span>
		</Link>
	);
}

export function SocialRolesList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: roles, isLoading, error } = useSocialRoles(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'SOCIAL');

	if (error && roles === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<>
				<AddRoleCard guildId={guildId} />
				<Skeleton className="h-36 w-full rounded-lg" />
				<Skeleton className="h-36 w-full rounded-lg" />
			</>
		);
	}

	return (
		<>
			<AddRoleCard guildId={guildId} />
			{roles!.map((role) => (
				<SocialRoleCard
					guildId={guildId}
					key={role.roleId}
					role={role}
					roleInfo={guildInfo?.roles.find((entry) => entry.id === role.roleId)}
				/>
			))}
		</>
	);
}
