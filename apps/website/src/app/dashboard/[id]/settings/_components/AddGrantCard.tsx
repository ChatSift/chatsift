'use client';

import { useState } from 'react';
import { SnowflakeInput } from '../../ama/amas/new/_components/SnowflakeInput';
import { APIError } from '@/api/error';
import { useCreateGrant } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';

interface AddGrantCardProps {
	readonly guildId: string;
}

export function AddGrantCard({ guildId }: AddGrantCardProps) {
	const [userId, setUserId] = useState('');
	const [error, setError] = useState<string | null>(null);
	const createGrant = useCreateGrant(guildId);

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
			// Route sends 404 (user doesn't exist on Discord), 422 (`badData`, grant already exists), or 400
			// (zod validation failed on `userId` itself, e.g. not a valid snowflake) — see createGrant.ts.
			if (error instanceof APIError) {
				if (error.statusCode === 404) {
					setError('User not found');
				} else if (error.statusCode === 422) {
					setError('Grant already exists for this user');
				} else if (error.statusCode === 400) {
					setError(error.fieldError('userId') ?? 'Invalid User ID');
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
