'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { useCreateGrant } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { SnowflakeInput } from '@/components/common/SnowflakeInput';

export function CreateGrantForm() {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [userId, setUserId] = useState('');
	const [error, setError] = useState<string | null>(null);
	const createGrant = useCreateGrant(guildId);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!userId.trim()) {
			setError('User ID cannot be empty');
			return;
		}

		setError(null);

		try {
			await createGrant.mutateAsync({ userId: userId.trim() });
			router.replace(`/dashboard/${guildId}/settings`);
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
				} else {
					setError(error.message || 'Failed to add grant');
				}

				return;
			}

			setError('Failed to add grant');
			console.error('Failed to add grant', error);
		}
	};

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Grant Details</h2>

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
			</div>

			<div className="flex gap-4">
				<Button
					className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
					isDisabled={!userId.trim() || createGrant.isPending}
					type="submit"
				>
					{createGrant.isPending ? 'Adding...' : 'Add Grant'}
				</Button>
				<Button
					className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
					onPress={() => router.back()}
					type="button"
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
