import type { Metadata } from 'next';
import Link from 'next/link';
import { FaExclamationTriangle } from 'react-icons/fa';
import { FeatureChangeList } from './_components/FeatureChangeList';
import { OutcomeLegend } from './_components/OutcomeLegend';
import { FEATURE_CHANGE_GROUPS } from './_components/featureChanges';
import { Heading } from '@/components/common/Heading';
import { socialMetadata } from '@/utils/site';

export const metadata: Metadata = socialMetadata({
	title: "What's Changing in AutoModerator",
	description:
		'AutoModerator is being rebuilt. What stays the same, what works differently, what got better, and what is being retired.',
	path: '/automoderator/whats-changing',
});

export default function AutomoderatorWhatsChangingPage() {
	return (
		<div className="flex flex-col gap-8 pb-12">
			<Heading title="What's Changing in AutoModerator" />

			<p className="leading-relaxed text-secondary dark:text-secondary-dark">
				AutoModerator is being rebuilt from scratch on the platform AMA, ModMail and Social already run on. This is what
				to expect when it comes.
			</p>

			<OutcomeLegend />

			<div
				className="flex flex-col gap-2 rounded-lg border border-misc-warning/40 bg-misc-warning/10 p-4 text-sm text-misc-warning dark:border-misc-warning-dark/40 dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark"
				role="status"
			>
				<div className="flex items-center gap-2 font-medium">
					<FaExclamationTriangle className="h-4 w-4 shrink-0" />
					The most potentially breaking changes:
				</div>
				<ul className="ml-6 flex list-disc flex-col gap-1.5">
					<li>
						Your banned word lists are not carried across. Any feature tied to banned words (e.g. automatically
						punishing a user for using a certain banned word) will rely on the native AutoMod list.
					</li>
					<li>Mute roles are going away. Timeouts remain available.</li>
					<li>Self-assignable roles are going away.</li>
				</ul>
			</div>

			{FEATURE_CHANGE_GROUPS.map((group) => (
				<section className="flex flex-col gap-3" key={group.title}>
					<h2 className="text-xl font-medium text-primary dark:text-primary-dark">{group.title}</h2>
					<FeatureChangeList group={group} />
				</section>
			))}

			<p className="text-sm text-secondary dark:text-secondary-dark">
				Want to chat about this?{' '}
				<Link className="underline underline-offset-2" href="/support">
					Find us in the support server
				</Link>
				.
			</p>
		</div>
	);
}
