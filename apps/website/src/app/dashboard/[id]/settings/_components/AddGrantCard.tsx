'use client';

import { useState } from 'react';
import { SnowflakeInput } from '../../ama/amas/new/_components/SnowflakeInput';
import { Button } from '@/components/common/Button';
import { client } from '@/data/client';
import { APIError } from '@/utils/fetcher';

interface AddGrantCardProps {
	readonly guildId: string;
}

export function AddGrantCard({ guildId }: AddGrantCardProps) {
	const [userId, setUserId] = useState('');
	const [error, setError] = useState<string | null>(null);
	const createGrant = client.guilds.grants.useCreateGrant(guildId);

	const handleSubmit = async () => {
		if (!userId.trim()) {
			setError('User ID cannot be empty');
			return;
		}

		setError(null);

		try {
			await createGrant.mutateAsync({ userId: userId.trim() });
			setUserId('');
		} catch (error) {
			if (error instanceof APIError) {
				if (error.payload.statusCode === 404) {
					setError('User not found');
				} else if (error.payload.statusCode === 400) {
					setError('Grant already exists for this user');
				} else if (error.payload.statusCode === 422) {
					setError('Invalid User ID');
				}

				return;
			}

			setError('Failed to add grant');
			console.error('Failed to add grant', error);
		}
	};

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-dashed border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<SnowflakeInput
				error={error ?? undefined}
				id="userId"
				label="Add User by ID"
				onChange={(value) => {
					setUserId(value);
					setError(null);
				}}
				placeholder="Enter user ID..."
				value={userId}
			/>
			<div className="mt-auto flex justify-end">
				<Button isDisabled={!userId.trim()} onPress={handleSubmit}>
					Add Grant
				</Button>
			</div>
		</div>
	);
}
