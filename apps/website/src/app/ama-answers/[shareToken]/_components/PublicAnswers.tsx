'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { FaExclamationCircle } from 'react-icons/fa';
import { queryKeys } from '@/api/queryClient';
import type { PublicUserInfo } from '@/api/routes/ama';
import { usePublicAMAAnswers } from '@/api/routes/ama';
import { EmptyState } from '@/components/common/EmptyState';
import { GenericAvatar } from '@/components/common/GenericAvatar';
import { Skeleton } from '@/components/common/Skeleton';
import { usePublicRealtimeClient } from '@/hooks/usePublicRealtimeClient';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { formatDate } from '@/utils/util';

function PublicUserBadge({ user }: { readonly user: PublicUserInfo }) {
	return (
		<div className="flex items-center gap-2">
			<GenericAvatar
				assetURL={user.avatarUrl ?? undefined}
				className="h-8 w-8 rounded-full"
				disableLink
				initials={user.displayName.slice(0, 2)}
				isLoading={false}
			/>
			<span className="font-medium text-primary dark:text-primary-dark">{user.displayName}</span>
		</div>
	);
}

/**
 * Unauthenticated, read-only mirror of an AMA's answers channel (#293 follow-up) -- for people
 * without server access to still read what was asked/answered. Lives outside `/dashboard` entirely,
 * same "outside the authenticated tree" placement as `/privacy`/`/terms`.
 */
export function PublicAnswers() {
	const { shareToken } = useParams<{ shareToken: string }>();
	const queryClient = useQueryClient();
	const realtimeClient = usePublicRealtimeClient(shareToken);
	const { data, isLoading, error } = usePublicAMAAnswers(shareToken);

	// Live updates for this page too (#323) -- someone watching along while an AMA runs shouldn't have to
	// refresh to see the next answer land. The channel comes off the response rather than being built here:
	// `amaPublicAnswersChannel` needs the ama id, and a share-token viewer never learns it. Undefined until
	// the first fetch resolves, which the hook already no-ops on.
	useRealtimeInvalidate(
		data?.realtimeChannel,
		() => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.ama.publicAnswers(shareToken) });
		},
		realtimeClient,
	);

	if (isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-32 w-full" />
				<Skeleton className="h-32 w-full" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<EmptyState
				icon={<FaExclamationCircle className="h-8 w-8 text-misc-danger" />}
				subtitle="This link may be invalid, or the AMA no longer exists."
				title="AMA not found"
			/>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-semibold text-primary dark:text-primary-dark">{data.title}</h1>

			{data.questions.length === 0 ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">No questions have been answered yet.</p>
			) : (
				<div className="flex flex-col gap-4">
					{data.questions.map((question) => (
						<div
							className="rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark"
							key={question.id}
						>
							<PublicUserBadge user={question.author} />
							<p className="mt-2 whitespace-pre-wrap text-primary dark:text-primary-dark">{question.content}</p>
							<p className="mt-1 text-xs text-secondary dark:text-secondary-dark">
								{formatDate(new Date(question.askedAt))}
							</p>

							{question.answerContent && (
								<div className="mt-4 border-l-2 border-misc-accent pl-4">
									{question.answeredBy && (
										<div className="mb-1">
											<PublicUserBadge user={question.answeredBy} />
										</div>
									)}
									<p className="whitespace-pre-wrap text-primary dark:text-primary-dark">{question.answerContent}</p>
									{question.answerImageUrl && (
										// External, unregistered Discord CDN domain -- not worth wiring into next/image's
										// remote-pattern allowlist for this one public page. `referrerPolicy` avoids
										// leaking this (unauthenticated, publicly-linkable) page's URL to whatever host
										// the image ends up on; `loading="lazy"` defers fetching until it's in view.
										// eslint-disable-next-line @next/next/no-img-element
										<img
											alt="Answer attachment"
											className="mt-2 max-w-full rounded-md"
											loading="lazy"
											referrerPolicy="no-referrer"
											src={question.answerImageUrl}
										/>
									)}
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
