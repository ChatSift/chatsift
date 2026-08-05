import { BOTS } from '@chatsift/core';
import { Heading } from '@/components/common/Heading';
import { BotCard } from '@/components/marketing/BotCard';
import { LinkButton } from '@/components/marketing/LinkButton';
import { marketingBots } from '@/data/marketingBots';

export default function HomePage() {
	return (
		<div className="flex flex-col gap-12 pb-12">
			<section className="flex flex-col gap-6">
				<h2 className="text-3xl font-medium text-primary dark:text-primary-dark">
					Built for how your server actually runs
				</h2>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
					<LinkButton external href="/support">
						Join our Discord server
					</LinkButton>
				</div>
			</section>
			<section className="flex flex-col gap-4">
				<h3 className="text-2xl font-medium text-primary dark:text-primary-dark">Our bots</h3>
				<ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{BOTS.map((bot) => (
						<li key={bot}>
							<BotCard bot={bot} cardDescription={marketingBots[bot].cardDescription} />
						</li>
					))}
				</ul>
			</section>
			<section className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
				<Heading subtitle="Donate on Ko-fi to help support the apps we're developing." title="Support the project" />
				<LinkButton external href="/kofi">
					Donate
				</LinkButton>
			</section>
		</div>
	);
}
