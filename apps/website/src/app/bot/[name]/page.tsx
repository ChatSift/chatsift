import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Heading } from '@/components/common/Heading';
import { FeatureGrid } from '@/components/marketing/FeatureGrid';
import { LinkButton } from '@/components/marketing/LinkButton';
import { ScreenshotGallery } from '@/components/marketing/ScreenshotGallery';
import { MARKETED_BOTS, marketingBots, resolveBot } from '@/data/marketingBots';
import { Bots } from '@/utils/bots';
import { socialMetadata } from '@/utils/site';

export function generateStaticParams() {
	return MARKETED_BOTS.map((bot) => ({ name: bot.toLowerCase() }));
}

export async function generateMetadata({ params }: PageProps<'/bot/[name]'>): Promise<Metadata> {
	const { name } = await params;
	const bot = resolveBot(name);
	if (!bot) {
		return { title: 'Bot not found' };
	}

	const marketing = marketingBots[bot];
	return socialMetadata({
		title: marketing.pageTitle,
		description: marketing.cardDescription,
		path: `/bot/${name}`,
		hasOwnImage: true,
	});
}

export default async function BotPage({ params }: PageProps<'/bot/[name]'>) {
	const { name } = await params;
	const bot = resolveBot(name);
	if (!bot) {
		notFound();
	}

	const marketing = marketingBots[bot];
	const { label } = Bots[bot];
	const otherBots = MARKETED_BOTS.filter((otherBot) => otherBot !== bot);

	return (
		<div className="flex flex-col gap-12 pb-12">
			<section className="flex flex-col gap-6">
				<ScreenshotGallery botName={label} screenshots={marketing.screenshots} />
				<div className="flex flex-col gap-3">
					<h1 className="text-3xl font-medium text-primary dark:text-primary-dark">{marketing.pageTitle}</h1>
					{marketing.pageDescription.map((line) => (
						<p className="text-secondary dark:text-secondary-dark" key={line}>
							{line}
						</p>
					))}
				</div>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
					<LinkButton external href={`/invites/${bot.toLowerCase()}`}>
						Add to server
					</LinkButton>
					<LinkButton external href="/support" variant="ghost">
						Get support
					</LinkButton>
				</div>
			</section>
			<section className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<h2 className="text-xl font-medium text-primary dark:text-primary-dark">{marketing.features.title}</h2>
					<p className="text-secondary dark:text-secondary-dark">{marketing.features.text}</p>
				</div>
				<FeatureGrid features={marketing.features.items} />
			</section>
			{otherBots.length > 0 && (
				<section className="flex flex-col gap-4">
					<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Check out our other bots</h2>
					<ul className="flex flex-col gap-4 sm:flex-row">
						{otherBots.map((otherBot) => {
							const otherMarketing = marketingBots[otherBot];
							const { Icon, label: otherLabel } = Bots[otherBot];
							return (
								<li
									className="flex-1 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark"
									key={otherBot}
								>
									<Link className="flex flex-col gap-2" href={`/bot/${otherBot.toLowerCase()}`} prefetch>
										<div className="flex items-center gap-2 text-lg font-medium text-primary dark:text-primary-dark">
											<Icon height={24} width={24} />
											{otherLabel}
										</div>
										<p className="text-sm text-secondary dark:text-secondary-dark">{otherMarketing.otherBotUpsell}</p>
									</Link>
								</li>
							);
						})}
					</ul>
				</section>
			)}
			<section className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
				<Heading
					subtitle="Donate on Ko-fi to help support the apps we're developing."
					title="Help keep the project alive"
				/>
				<LinkButton external href="/kofi">
					Donate
				</LinkButton>
			</section>
		</div>
	);
}
