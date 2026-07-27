'use client';

import { useParams } from 'next/navigation';
import { DashboardCrumbs } from './DashboardCrumbs';
import { useModmailCategories } from '@/api/routes/modmail';

/**
 * Resolves the `modmail/categories/[categoryId]` breadcrumb segment to the category's name -- mirrors
 * `ModmailPanelCrumbs`'s equivalent for `modmail/panels/[panelId]`.
 */
export function ModmailCategoryCrumbs() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: categories } = useModmailCategories(guildId);

	return <DashboardCrumbs segmentOptionsData={{ modmailCategories: categories }} />;
}
