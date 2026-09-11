'use client';

import type { BotId } from '@chatsift/core';
import { cn } from '@chatsift/web-core/utils/cn';
import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { PropsWithChildren } from 'react';
import { useRef, useState } from 'react';
import { FaWrench } from 'react-icons/fa';
import { GuildIcon } from '@/components/common/GuildIcon';
import { CommandPaletteTrigger } from '@/components/dashboard/CommandPalette';
import { useGuildAccess } from '@/hooks/useGuildAccess';
import { AUTOMODERATOR_SECTION_GROUPS } from '@/utils/automoderatorSections';
import { BOT_SECTIONS } from '@/utils/botSections';
import { BotIcon, resolveBotBranding } from '@/utils/bots';

const TAB_CLASS = 'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors';

const TAB_IDLE_CLASS =
	'text-secondary hover:bg-on-tertiary hover:text-primary dark:text-secondary-dark dark:hover:bg-on-tertiary-dark dark:hover:text-primary-dark';

const TAB_ACTIVE_CLASS = 'bg-on-tertiary text-primary dark:bg-on-tertiary-dark dark:text-primary-dark';

// A shade darker than the active tab, on purpose: hover and active already paint the same, so a tab with its
// menu open needs a state of its own or it reads as the page you are on. The `hover:` half is what wins while
// the pointer is still on the tab -- which, since hovering is what opens the menu, it usually is.
const TAB_OPEN_CLASS =
	'data-[state=open]:bg-on-secondary data-[state=open]:text-primary data-[state=open]:hover:bg-on-secondary dark:data-[state=open]:bg-on-secondary-dark dark:data-[state=open]:text-primary-dark dark:data-[state=open]:hover:bg-on-secondary-dark';

function tabClassName(isActive: boolean) {
	return cn(TAB_CLASS, isActive ? TAB_ACTIVE_CLASS : TAB_IDLE_CLASS, TAB_OPEN_CLASS);
}

const PANEL_LINK_CLASS =
	'flex items-center whitespace-nowrap rounded-md px-3 py-2 text-base outline-none hover:bg-on-tertiary hover:text-primary focus-visible:bg-on-tertiary focus-visible:text-primary dark:hover:bg-on-tertiary-dark dark:hover:text-primary-dark dark:focus-visible:bg-on-tertiary-dark dark:focus-visible:text-primary-dark';

interface PanelLinkProps extends PropsWithChildren {
	readonly href: string;
	readonly isActive: boolean;
}

function PanelLink({ href, isActive, children }: PanelLinkProps) {
	return (
		<NavigationMenu.Link active={isActive} asChild>
			<Link
				className={cn(
					PANEL_LINK_CLASS,
					isActive ? 'text-primary dark:text-primary-dark' : 'text-secondary dark:text-secondary-dark',
				)}
				href={href}
				prefetch
			>
				{children}
			</Link>
		</NavigationMenu.Link>
	);
}

interface BotPanelProps {
	readonly bot: BotId;
	readonly guildId: string;
	readonly pathname: string;
}

/**
 * A bot's sections, title only: the hub explains what each one is for, the menu is for people who already know
 * where they are going. AutoModerator keeps the hub's grouping because fifteen equal rows would say nothing
 * about which two you open daily; every other bot has few enough for one column.
 */
function BotPanel({ bot, guildId, pathname }: BotPanelProps) {
	const base = `/dashboard/${guildId}/${bot.toLowerCase()}`;

	if (bot === 'AUTOMODERATOR') {
		return (
			<div className="grid grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-4">
				{AUTOMODERATOR_SECTION_GROUPS.map((group) => (
					<div className="flex min-w-0 flex-col" key={group.title}>
						{/* Heavier than the hub's `PageSection` title on purpose: there it floats above cards with room
						    around it, here it sits directly on rows in the same muted colour and vanished into them. */}
						<p className="mx-3 mb-1 border-b border-on-secondary pb-1.5 pt-1.5 text-xs font-semibold tracking-wide text-primary uppercase dark:border-on-secondary-dark dark:text-primary-dark">
							{group.title}
						</p>
						{group.sections.map((section) => {
							const href = `${base}/${section.segment}`;
							return (
								<PanelLink href={href} isActive={pathname.startsWith(href)} key={section.segment}>
									{section.title}
								</PanelLink>
							);
						})}
					</div>
				))}
			</div>
		);
	}

	return (
		<div className="flex min-w-[220px] flex-col">
			{BOT_SECTIONS[bot].map((section) => {
				const href = `${base}/${section.segment}`;
				return (
					<PanelLink href={href} isActive={pathname.startsWith(href)} key={section.segment}>
						{section.title}
					</PanelLink>
				);
			})}
		</div>
	);
}

/**
 * Persistent sub-nav for everything under `/dashboard/[id]`. Relies on the parent `NavGateCheck` (see
 * `[id]/layout.tsx`) having already gated out guilds the user can't access, so `guild` below is assumed to exist.
 * New products show up here automatically once they're added to `BOTS`/`Bots` and `BOT_SECTIONS`.
 *
 * Each bot tab is two things at once: a link to the bot's hub, and (from `lg` up, where there is a pointer to
 * hover with) the trigger for a menu of its sections, so any section of any bot is one click from any page.
 * Radix's trigger does not swallow the click, which is what lets one element be both -- on a phone a tap just
 * follows the link, and the hub's cards are the menu there. Keyboard users get the hub the same way.
 */
export function GuildNav() {
	const params = useParams<{ id: string }>();
	const pathname = usePathname();
	// A guest with no general manage access only ever gets the AMA tab -- Overview/Settings/other bots
	// all assume manager-level guild config access `NavGateCheck` doesn't grant them (see its
	// `isAmaGuestOnly` carve-out, scoped the same way).
	const { guild, isAmaGuestOnly } = useGuildAccess(params.id);
	const rootRef = useRef<HTMLElement | null>(null);
	// The open tab, held here rather than by Radix: uncontrolled, Radix reports a change from an effect, one
	// render after the panel is already on screen -- at the previous tab's position, for a frame. Controlled,
	// the value and the position below land in the same render.
	const [value, setValue] = useState('');
	// Where the open panel hangs from. Radix's viewport is one box for every panel, so this measures the tab as
	// it opens; the tabs scroll, and a panel inside the scrolling half would be clipped. Tabs in the right half
	// of the row anchor by their right edge so a panel never runs past the row; the wide grouped panel starts
	// at the row's left edge regardless.
	const [anchor, setAnchor] = useState<{ readonly offset: number; readonly side: 'end' | 'start' }>({
		offset: 0,
		side: 'start',
	});

	// A navigation lands with the menu closed. Needed for the phone, where the tap that follows a tab's link
	// also toggles its menu open and no pointer-leave is coming to close it. Reset during render rather than
	// in an effect so the new page never paints a frame with the old menu up.
	const [lastPathname, setLastPathname] = useState(pathname);
	if (pathname !== lastPathname) {
		setLastPathname(pathname);
		setValue('');
	}

	if (!guild || !pathname) {
		return null;
	}

	const handleValueChange = (next: string) => {
		setValue(next);

		const root = rootRef.current;
		const trigger = next && root ? root.querySelector<HTMLElement>(`[data-tab="${next}"]`) : null;
		if (!root || !trigger) {
			return;
		}

		if (next === 'AUTOMODERATOR') {
			setAnchor({ side: 'start', offset: 0 });
			return;
		}

		const rootRect = root.getBoundingClientRect();
		const triggerRect = trigger.getBoundingClientRect();
		const isInRightHalf = triggerRect.left + triggerRect.width / 2 > rootRect.left + rootRect.width / 2;
		setAnchor(
			isInRightHalf
				? { side: 'end', offset: rootRect.right - triggerRect.right }
				: { side: 'start', offset: triggerRect.left - rootRect.left },
		);
	};

	const overviewHref = `/dashboard/${guild.id}`;
	const settingsHref = `${overviewHref}/settings`;

	const botItems = guild.bots
		.filter((bot) => !isAmaGuestOnly || bot === 'AMA')
		.map((bot) => {
			const branding = resolveBotBranding(guild, bot);
			return {
				bot,
				label: branding.label,
				// Skip the AMA hub for a guest -- `NavGateCheck` would only bounce them off it to the sessions
				// list anyway, and a nav tab that visibly redirects reads as broken.
				href: isAmaGuestOnly && bot === 'AMA' ? `${overviewHref}/ama/amas` : `${overviewHref}/${bot.toLowerCase()}`,
				icon: <BotIcon bot={bot} branding={branding} height={16} width={16} />,
			};
		});

	return (
		<NavigationMenu.Root className="relative" onValueChange={handleValueChange} ref={rootRef} value={value}>
			<div className="flex items-center gap-2 border-b border-on-secondary pb-3 dark:border-on-secondary-dark">
				{/* The tabs scroll on their own so the palette trigger stays put at the row's right edge: with every
				    bot installed the tabs already overrun the 912px column on desktop, and a trigger inside the
				    scrolling half would be the first thing pushed out of view. */}
				<div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
					<GuildIcon data={guild} disableLink hasBots size={36} />

					<NavigationMenu.List className="flex items-center gap-2">
						{!isAmaGuestOnly && (
							<>
								<NavigationMenu.Item>
									<NavigationMenu.Link active={pathname === overviewHref} asChild>
										<Link className={tabClassName(pathname === overviewHref)} href={overviewHref} prefetch>
											Overview
										</Link>
									</NavigationMenu.Link>
								</NavigationMenu.Item>
								<NavigationMenu.Item>
									<NavigationMenu.Link active={pathname.startsWith(settingsHref)} asChild>
										<Link className={tabClassName(pathname.startsWith(settingsHref))} href={settingsHref} prefetch>
											<FaWrench className="h-4 w-4" />
											Settings
										</Link>
									</NavigationMenu.Link>
								</NavigationMenu.Item>
							</>
						)}

						{botItems.map(({ bot, href, label, icon }) => {
							const isActive = pathname.startsWith(href);

							// A guest's one tab gets no menu: the sessions list is the only page they can open, and
							// the tab already points there.
							if (isAmaGuestOnly) {
								return (
									<NavigationMenu.Item key={bot}>
										<NavigationMenu.Link active={isActive} asChild>
											<Link className={tabClassName(isActive)} href={href} prefetch>
												{icon}
												{label}
											</Link>
										</NavigationMenu.Link>
									</NavigationMenu.Item>
								);
							}

							return (
								<NavigationMenu.Item key={bot} value={bot}>
									<NavigationMenu.Trigger asChild>
										<Link className={tabClassName(isActive)} data-tab={bot} href={href} prefetch>
											{icon}
											{label}
										</Link>
									</NavigationMenu.Trigger>
									<NavigationMenu.Content
										className={cn(
											// Hangs off whichever edge the viewport is anchored by (see `anchor`), so it is in the
											// right place from its first frame with no width to know first.
											'absolute top-0 left-0 rounded-lg border border-on-secondary bg-card p-1 shadow-lg group-data-[anchor=end]:right-0 group-data-[anchor=end]:left-auto dark:border-on-secondary-dark dark:bg-card-dark',
											// The grouped panel is sized rather than shrink-wrapped so its four columns share the
											// width evenly; two columns on a phone, where a tap never opens it anyway.
											bot === 'AUTOMODERATOR' ? 'w-[calc(100vw-2rem)] lg:w-[44rem]' : 'w-max max-w-[calc(100vw-2rem)]',
										)}
									>
										<BotPanel bot={bot} guildId={guild.id} pathname={pathname} />
									</NavigationMenu.Content>
								</NavigationMenu.Item>
							);
						})}
					</NavigationMenu.List>
				</div>

				<CommandPaletteTrigger />
			</div>

			{/* A zero-size anchor point under the open tab that the panel hangs off, rather than a box sized from
			    Radix's measured `--radix-navigation-menu-viewport-*` variables: those arrive a frame after the
			    panel does, and a position derived from them draws somewhere else first. */}
			<NavigationMenu.Viewport
				className="group absolute top-full z-40 mt-2"
				data-anchor={anchor.side}
				style={anchor.side === 'end' ? { right: anchor.offset } : { left: anchor.offset }}
			/>
		</NavigationMenu.Root>
	);
}
