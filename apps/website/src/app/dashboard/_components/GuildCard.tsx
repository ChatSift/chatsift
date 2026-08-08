import { BOTS } from '@chatsift/core';
import Link from 'next/link';
import { Link as AriaLink } from 'react-aria-components';
import type { MeGuild } from '@/api/routes/auth';
import { GuildIcon } from '@/components/common/GuildIcon';
import { Tooltip } from '@/components/common/Tooltip';
import { BotIcon, Bots, resolveBotBranding } from '@/utils/bots';
import { cn } from '@/utils/util';

interface GuildCardProps {
	readonly data: MeGuild;
	/**
	 * True when the viewer's only access to this guild is AMA-guest access -- no `meCanManage`, just an entry
	 * in some session's `guest_ids` (see `useGuildAccess`'s `isAmaGuestOnly`). The card then advertises only
	 * AMA (other bots installed here are ones they can't open, and `GuildNav` hides them for the same reason)
	 * and links straight at the sessions list rather than the manager-only guild root.
	 */
	readonly isGuest?: boolean;
}

const BOT_ICON_SIZE = 28;

export default function GuildCard({ data, isGuest }: GuildCardProps) {
	const bots = isGuest ? data.bots.filter((bot) => bot === 'AMA') : data.bots;
	const hasBots = bots.length > 0;
	// A guest always has somewhere to go even with no bot icons to show -- their access comes from a session
	// row, not from the AMA bot still being in this guild's `GuildList`.
	const isLinked = isGuest || hasBots;
	// Deliberately not the guild root: that page is the manager-only settings hub, and a guest landing there
	// only gets bounced onwards by `NavGateCheck` anyway.
	const url = isGuest ? `/dashboard/${data.id}/ama/amas` : hasBots ? `/dashboard/${data.id}` : undefined;

	return (
		<div
			className={cn(
				'relative flex h-[9.5rem] w-full min-w-0 flex-col gap-3 overflow-hidden rounded-lg border-[1px] border-on-secondary p-3 dark:border-on-secondary-dark',
				isLinked ? 'bg-card dark:bg-card-dark' : 'group',
			)}
		>
			<GuildIcon data={data} disableLink={isLinked} hasBots={isLinked} />

			{isGuest && (
				<span className="absolute right-3 top-3 rounded bg-misc-accent/10 px-2 py-1 text-xs font-medium text-misc-accent">
					Guest
				</span>
			)}

			<div className="flex min-w-0 flex-col gap-1">
				<p className="truncate text-lg font-medium text-primary dark:text-primary-dark">{data.name}</p>

				{isLinked ? (
					<ul className="flex flex-row items-center gap-1">
						{bots.map((bot) => {
							const branding = resolveBotBranding(data, bot);
							return (
								<li key={bot}>
									<BotIcon bot={bot} branding={branding} height={BOT_ICON_SIZE} width={BOT_ICON_SIZE} />
									<span className="sr-only">{branding.label}</span>
								</li>
							);
						})}
					</ul>
				) : (
					<div className="grid">
						<p className="col-start-1 row-start-1 text-lg font-normal text-secondary group-hover:invisible dark:text-secondary-dark">
							Not invited
						</p>
						<div className="invisible col-start-1 row-start-1 flex flex-row items-center gap-3 group-hover:visible">
							<p className="text-lg font-medium text-primary dark:text-primary-dark">Invite a bot:</p>
							<ul className="flex flex-row items-center gap-3">
								{BOTS.map((bot) => {
									const { Icon, label } = Bots[bot];
									return (
										<li key={bot}>
											<Tooltip content={`Invite ${label}`}>
												<AriaLink href={`/invites/${bot.toLowerCase()}`}>
													<Icon height={BOT_ICON_SIZE} width={BOT_ICON_SIZE} />
													<span className="sr-only">Invite {label}</span>
												</AriaLink>
											</Tooltip>
										</li>
									);
								})}
							</ul>
						</div>
					</div>
				)}
			</div>

			{isLinked && url ? (
				<Link
					className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misc-accent"
					href={url}
					prefetch
				>
					<span className="sr-only">{data.name}</span>
				</Link>
			) : null}
		</div>
	);
}
