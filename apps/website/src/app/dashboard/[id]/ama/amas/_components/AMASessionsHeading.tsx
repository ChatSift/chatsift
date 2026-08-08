'use client';

import { useParams } from 'next/navigation';
import { Heading } from '@/components/common/Heading';
import { useGuildAccess } from '@/hooks/useGuildAccess';

/**
 * Thin client wrapper around `Heading`, purely so this page's subtitle can match the viewer's access tier.
 * This is a guest's landing page (see `NavGateCheck`'s guest redirect) and the manager copy -- "create and
 * manage AMAs in your community" -- describes nothing they can actually do: sessions are filtered server-side
 * to the ones they're a guest on (`getAMAs.ts`), and every create/edit control is gated on `canManage`.
 */
export function AMASessionsHeading() {
	const params = useParams<{ id: string }>();
	const { isAmaGuestOnly } = useGuildAccess(params.id);

	return (
		<Heading
			subtitle={
				isAmaGuestOnly
					? "AMA sessions you've been invited to answer questions in"
					: 'Create and manage AMAs in your community'
			}
			title="AMA sessions"
		/>
	);
}
