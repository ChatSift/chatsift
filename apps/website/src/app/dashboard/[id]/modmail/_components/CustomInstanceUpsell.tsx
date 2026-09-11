'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { ConfirmModal } from '@chatsift/web-core/components/ConfirmModal';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { cn } from '@chatsift/web-core/utils/cn';
import type { APIUser, Snowflake } from '@discordjs/core';
import { useState } from 'react';
import { FaPaintBrush, FaRegCheckCircle } from 'react-icons/fa';
import { useMe } from '@/api/routes/auth';
import { useModmailInstanceInterest, useRegisterModmailInstanceInterest } from '@/api/routes/modmail';
import { formatDate } from '@/utils/util';

interface CustomInstanceUpsellProps {
	readonly guildId: string;
}

function userLabel(user: APIUser | Snowflake): string {
	if (typeof user === 'string') {
		return user;
	}

	return user.global_name ?? `${user.username}${user.discriminator === '0' ? '' : `#${user.discriminator}`}`;
}

/**
 * Asks whether this server wants ModMail under its own bot (#216, docs/roadmap/01-architecture.md §8) and
 * records the answer for an operator to follow up on. Nothing about a custom instance is self-serve -- the
 * registry row holds a live bot token and is written by hand -- so the most the dashboard can do is put the
 * conversation in motion.
 *
 * Registering is one-way on purpose (there is no delete route), so once it is spent the card stops offering
 * the button and shows who spent it instead. Hidden entirely for a guild that already has an instance.
 */
export function CustomInstanceUpsell({ guildId }: CustomInstanceUpsellProps) {
	const { data: me } = useMe();
	const { data, isLoading } = useModmailInstanceInterest(guildId);
	const registerInterest = useRegisterModmailInstanceInterest(guildId);
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);

	const isCustomInstance = (me?.guilds.find((guild) => guild.id === guildId)?.customInstanceId ?? null) !== null;

	// `!me` is part of the gate, not just defensiveness: without it a guild that already *has* an instance
	// would flash the pitch for however long `/me` is still in flight, since an unresolved `me` reads as "no
	// instance". Nothing rather than a skeleton while either query loads -- this sits under the section list
	// as an aside, and a placeholder that resolves to "hidden" for every partner guild is jumpier than a late
	// arrival.
	if (!me || isCustomInstance || isLoading || !data) {
		return null;
	}

	if (data.interest) {
		return (
			<div className="flex items-start gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-on-tertiary dark:bg-on-tertiary-dark">
					<FaRegCheckCircle className="h-6 w-6 text-misc-accent" />
				</div>
				<div className="flex flex-col gap-1">
					<p className="text-lg font-medium text-primary dark:text-primary-dark">Custom instance interest registered</p>
					<p className="text-sm text-secondary dark:text-secondary-dark">
						Registered by {userLabel(data.interest.user)} on {formatDate(new Date(data.interest.createdAt))}. We will
						reach out.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark md:flex-row md:items-center md:justify-between">
			<div className="flex items-start gap-4">
				<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-on-tertiary dark:bg-on-tertiary-dark">
					<FaPaintBrush className="h-5 w-5 text-secondary dark:text-secondary-dark" />
				</div>
				<div className="flex flex-col gap-1">
					<p className="text-lg font-medium text-primary dark:text-primary-dark">Want ModMail under your own bot?</p>
					<p className="text-sm text-secondary dark:text-secondary-dark">
						A custom instance is a ModMail deployment of your own: your name, avatar, and branding. Everything on this
						page unchanged. Tell us you are interested and we will get in touch about setting one up.
					</p>
				</div>
			</div>

			<Button className={cn(buttonClass('primary', 'sm'), 'shrink-0')} onPress={() => setIsConfirmOpen(true)}>
				I am interested
			</Button>

			<ConfirmModal
				confirmLabel="Register interest"
				isOpen={isConfirmOpen}
				onConfirm={async () => {
					await registerInterest.mutateAsync();
				}}
				onOpenChange={setIsConfirmOpen}
				title="Let us know you are interested?"
			>
				We record your account and this server so we know who to reach out to.
			</ConfirmModal>
		</div>
	);
}
