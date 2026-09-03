'use client';

import {
	ANTISPAM_MAX_AMOUNT,
	ANTISPAM_MAX_SECONDS,
	ANTISPAM_MIN_AMOUNT,
	automoderatorConfigChannel,
} from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { buttonClass } from '@/components/common/buttonStyles';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

/**
 * Anti-spam (P5c, feature 07): delete a member's burst when they send too many messages too quickly.
 *
 * No on/off toggle beside the two numbers, unlike the URL and invite filter pages. The threshold *is* the
 * setting -- "anti-spam on, no threshold" is not a configuration a server can mean, where "URL filter on, empty
 * allowlist" is (it means no links at all). Clearing both fields is how it goes off, and the copy says so.
 */
export function AntiSpamForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorConfigChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.config(guildId) });
	});

	const { data: config, isLoading, error } = useAutomoderatorConfig(guildId);
	const updateConfig = useUpdateAutomoderatorConfig(guildId);

	const [form, setForm] = useState<{ amount: string; time: string } | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	// Seeded once, then left alone: a background refetch must not clobber an unsaved edit.
	useEffect(() => {
		if (config && form === null) {
			setForm({
				amount: config.antispamAmount === null ? '' : String(config.antispamAmount),
				time: config.antispamTime === null ? '' : String(config.antispamTime),
			});
		}
	}, [config, form]);

	if (error && config === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !config || form === null) {
		return <Skeleton className="h-64 w-full rounded-lg" />;
	}

	const stored = {
		amount: config.antispamAmount === null ? '' : String(config.antispamAmount),
		time: config.antispamTime === null ? '' : String(config.antispamTime),
	};
	const isDirty = form.amount.trim() !== stored.amount || form.time.trim() !== stored.time;
	const isEnabled = config.antispamAmount !== null;

	const save = async () => {
		const amount = form.amount.trim();
		const time = form.time.trim();

		// Both or neither, matching the API and the CHECK behind it. Caught here so the message names the empty
		// box rather than coming back as a rejected write about a column pair.
		if ((amount === '') !== (time === '')) {
			setActionError('Fill in both boxes to turn anti-spam on, or clear both to turn it off.');
			return;
		}

		let body: { antispamAmount: number | null; antispamTime: number | null } = {
			antispamAmount: null,
			antispamTime: null,
		};

		if (amount !== '') {
			const parsedAmount = Number(amount);
			const parsedTime = Number(time);

			if (!Number.isInteger(parsedAmount) || parsedAmount < ANTISPAM_MIN_AMOUNT || parsedAmount > ANTISPAM_MAX_AMOUNT) {
				setActionError(`Pick a whole number of messages between ${ANTISPAM_MIN_AMOUNT} and ${ANTISPAM_MAX_AMOUNT}.`);
				return;
			}

			if (!Number.isInteger(parsedTime) || parsedTime < 1 || parsedTime > ANTISPAM_MAX_SECONDS) {
				setActionError(`Pick a whole number of seconds between 1 and ${ANTISPAM_MAX_SECONDS}.`);
				return;
			}

			body = { antispamAmount: parsedAmount, antispamTime: parsedTime };
		}

		setActionError(null);

		try {
			await updateConfig.mutateAsync(body);
			setForm({ amount, time });
		} catch (caughtError) {
			setActionError(caughtError instanceof APIError ? caughtError.message : 'Failed to save. Please try again.');
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				{actionError && (
					<p
						className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger"
						role="alert"
					>
						{actionError}
					</p>
				)}

				<p className="text-sm text-secondary dark:text-secondary-dark">
					{isEnabled
						? `Anti-spam is on: ${config.antispamAmount} messages from one member within ${config.antispamTime} seconds are all deleted, and the member is DMed why.`
						: 'Anti-spam is off. Fill in both boxes to turn it on.'}
				</p>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<TextField
						helper="How many messages count as a burst."
						id="automoderator-antispam-amount"
						label="Messages"
						max={ANTISPAM_MAX_AMOUNT}
						min={ANTISPAM_MIN_AMOUNT}
						onChange={(value) => {
							setForm((prev) => ({ ...prev!, amount: value }));
							setActionError(null);
						}}
						placeholder="5"
						type="number"
						value={form.amount}
					/>

					<TextField
						helper="The window they have to arrive in, in seconds."
						id="automoderator-antispam-time"
						label="Within (seconds)"
						max={ANTISPAM_MAX_SECONDS}
						min={1}
						onChange={(value) => {
							setForm((prev) => ({ ...prev!, time: value }));
							setActionError(null);
						}}
						placeholder="5"
						type="number"
						value={form.time}
					/>
				</div>

				<p className="text-sm text-secondary dark:text-secondary-dark">
					The whole burst is deleted, not just the message that tipped it over — across every channel they posted in.
					Editing a message never counts; only new ones do. Clear both boxes to turn anti-spam off.
				</p>

				<div className="flex flex-wrap gap-2">
					<Button
						className={buttonClass('primary', 'sm')}
						isDisabled={!isDirty || updateConfig.isPending}
						onPress={save}
					>
						{updateConfig.isPending ? 'Saving...' : 'Save'}
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<h3 className="text-sm font-medium text-primary dark:text-primary-dark">What happens after that</h3>
				<p className="text-sm text-secondary dark:text-secondary-dark">
					A burst is deleted and the member told why — nothing more, on its own. To punish repeat offenders, set up the{' '}
					<Link className="text-misc-accent hover:underline" href={`/dashboard/${guildId}/automoderator/filter-ladder`}>
						filter ladder
					</Link>
					, which counts anti-spam, URL and invite hits together. Channels and roles listed under{' '}
					<Link className="text-misc-accent hover:underline" href={`/dashboard/${guildId}/automoderator/exemptions`}>
						Exemptions
					</Link>{' '}
					are left alone.
				</p>
			</div>
		</div>
	);
}
