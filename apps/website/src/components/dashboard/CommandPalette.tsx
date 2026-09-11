'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useIsMounted } from '@chatsift/web-core/hooks/useIsMounted';
import { cn } from '@chatsift/web-core/utils/cn';
import { Command } from 'cmdk';
import { useParams, useRouter } from 'next/navigation';
import type { ComponentPropsWithoutRef, PropsWithChildren, ReactNode } from 'react';
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { FaWrench } from 'react-icons/fa';
import {
	amaSessionTargets,
	botSectionTargets,
	numberJumpKinds,
	numberJumps,
	otherGuildTargets,
	uniqueValues,
} from './commandPaletteTargets';
import { useAMAs } from '@/api/routes/ama';
import { useMe } from '@/api/routes/auth';
import { GuildIcon } from '@/components/common/GuildIcon';
import { SvgSearch } from '@/components/icons/SvgSearch';
import { resolveGuildAccess } from '@/hooks/useGuildAccess';
import { BotIcon, Bots, resolveBotBranding } from '@/utils/bots';
import { readRecentPages } from '@/utils/recentPages';

/**
 * The jump-to palette (Cmd/Ctrl+K). The dashboard is five levels deep and two of those levels are menu pages,
 * so a trip from one bot's leaf to another's went up to a hub and back down every time. This is the direct
 * route: type the section, server or case number and go.
 *
 * `cmdk` is the one dependency it added. It is small, it is the de-facto shape for this control, and it
 * covers what a hand-rolled version would have to get right one bug at a time -- fuzzy scoring, grouping,
 * arrow-key selection, the dialog's ARIA -- on the same Radix Dialog primitive the rest of the stack uses.
 */

interface CommandPaletteContextValue {
	open(): void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette(): CommandPaletteContextValue {
	const context = useContext(CommandPaletteContext);
	if (!context) {
		throw new Error('useCommandPalette must be used within CommandPaletteProvider');
	}

	return context;
}

export function CommandPaletteProvider({ children }: PropsWithChildren) {
	const [isOpen, setIsOpen] = useState(false);
	const open = useCallback(() => setIsOpen(true), []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				setIsOpen((current) => !current);
			}
		};

		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, []);

	const value = useMemo(() => ({ open }), [open]);

	return (
		<CommandPaletteContext.Provider value={value}>
			{children}
			<CommandPaletteDialog isOpen={isOpen} onOpenChange={setIsOpen} />
		</CommandPaletteContext.Provider>
	);
}

interface KbdProps extends PropsWithChildren {
	readonly className?: string;
}

function Kbd({ children, className }: KbdProps) {
	return (
		<kbd
			className={cn(
				'inline-flex items-center rounded border border-on-secondary bg-on-tertiary px-1.5 font-[inherit] text-xs font-medium text-secondary dark:border-on-secondary-dark dark:bg-on-tertiary-dark dark:text-secondary-dark',
				className,
			)}
		>
			{children}
		</kbd>
	);
}

/**
 * Sits at the right edge of `GuildNav`. The shortcut hint waits for mount: which modifier to show is a
 * `navigator` question, and the server has no answer the first client render would agree with.
 */
export function CommandPaletteTrigger() {
	const { open } = useCommandPalette();
	const isMounted = useIsMounted();
	const isMac = isMounted && navigator.userAgent.includes('Mac');

	return (
		<Button
			aria-label="Jump to"
			className={cn(buttonClass('secondary', 'sm'), 'shrink-0 gap-2')}
			onPress={open}
			type="button"
		>
			<SvgSearch size={16} />
			{isMounted && <Kbd className="hidden lg:inline-flex">{isMac ? '⌘K' : 'Ctrl K'}</Kbd>}
		</Button>
	);
}

const GROUP_CLASS =
	'[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-secondary dark:[&_[cmdk-group-heading]]:text-secondary-dark';

interface PaletteItemProps extends Omit<ComponentPropsWithoutRef<typeof Command.Item>, 'children'> {
	readonly icon: ReactNode;
	readonly label: string;
	/**
	 * The muted trail after the label -- which bot a `Config` belongs to, which server a recent page is in.
	 */
	readonly path?: string | undefined;
}

function PaletteItem({ icon, label, path, ...itemProps }: PaletteItemProps) {
	return (
		<Command.Item
			{...itemProps}
			className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-base text-primary data-[selected=true]:bg-on-tertiary dark:text-primary-dark dark:data-[selected=true]:bg-on-tertiary-dark"
		>
			<span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
			<span className="truncate">{label}</span>
			{path && <span className="ml-auto shrink-0 text-sm text-secondary dark:text-secondary-dark">{path}</span>}
		</Command.Item>
	);
}

// A recent page from a server the palette is not currently in has no `MeGuild` at hand to brand its icon
// with; the public product icon is the right fallback there, and the only wrong one would be another
// server's custom instance.
const NO_BRANDING = { customInstanceIconUrl: null, customInstanceId: null, customInstanceLabel: null };

interface CommandPaletteDialogProps {
	readonly isOpen: boolean;
	onOpenChange(isOpen: boolean): void;
}

/**
 * The palette is one level deep except for AMA sessions: "AMA by name" in the Go to group opens a page that
 * lists them, the way `cmdk` nests pages, and Backspace on an empty box comes back up. A title typed at the top
 * level still matches; the page exists so the list can be browsed without every session sitting in the empty
 * state. Cases, reports and threads get no such page -- there are too many to list, which is what the number
 * grammar is for.
 */
type PalettePage = 'ama' | null;

function CommandPaletteDialog({ isOpen, onOpenChange }: CommandPaletteDialogProps) {
	const router = useRouter();
	// `id` is only set under `/dashboard/[id]`; on the server list this is `{}` and the palette offers servers alone.
	const params = useParams<{ id?: string }>();
	const { data: me } = useMe();
	const [search, setSearch] = useState('');
	const [page, setPage] = useState<PalettePage>(null);

	const { guild, canManage, isAmaGuestOnly } = resolveGuildAccess(me, params.id);

	// Fetched the first time the palette opens rather than on every page load, and kept by react-query after
	// that. `isLoading` is only ever true during that first fetch; a disabled query reports false.
	const hasAma = (guild?.bots.includes('AMA') ?? false) && (canManage || isAmaGuestOnly);
	const { data: amaSessionsData, isLoading: isAmaLoading } = useAMAs(guild?.id ?? '', true, {
		enabled: isOpen && hasAma,
	});

	// Re-read on every open rather than once at mount: the breadcrumb writes an entry as each page renders,
	// so anything visited since the palette last opened would otherwise be missing.
	const recents = useMemo(() => (isOpen ? readRecentPages() : []), [isOpen]);

	const handleOpenChange = (open: boolean) => {
		onOpenChange(open);
		if (!open) {
			setSearch('');
			setPage(null);
		}
	};

	const navigate = (href: string) => {
		router.push(href);
		handleOpenChange(false);
	};

	const openPage = (next: PalettePage) => {
		setPage(next);
		setSearch('');
	};

	// The pages a number leads to are manager-only, so a guest is not offered the shortcut to them.
	const jumps = guild && canManage ? numberJumps(search, guild) : [];
	const jumpKinds = guild && canManage ? numberJumpKinds(guild) : [];
	const amaBranding = guild ? resolveBotBranding(guild, 'AMA') : null;
	const amaSessions = guild && amaSessionsData ? amaSessionTargets(guild, amaSessionsData) : [];
	const amaSessionValues = uniqueValues(amaSessions.map((session) => session.title));
	const sectionGroups = guild ? botSectionTargets(guild, { canManage, isAmaGuestOnly }) : [];
	const otherGuilds = otherGuildTargets(me?.guilds ?? [], guild?.id);
	const otherGuildValues = uniqueValues(otherGuilds.map((other) => other.name));

	// Rendered on the AMA page, and at the top level once something is typed (so a title is findable from
	// anywhere) -- but not in the top level's empty state, which is what the page is for.
	const amaSessionsGroup = amaBranding && amaSessions.length > 0 && (
		<Command.Group className={GROUP_CLASS} heading="AMA sessions">
			{amaSessions.map((session, index) => (
				<PaletteItem
					icon={<BotIcon bot="AMA" branding={amaBranding} height={20} width={20} />}
					key={session.id}
					keywords={['ama', 'session']}
					label={session.title}
					onSelect={() => navigate(session.href)}
					path={session.ended ? 'Submissions closed' : 'Submissions open'}
					value={amaSessionValues[index]!}
				/>
			))}
		</Command.Group>
	);

	let emptyMessage = 'Nothing matches.';
	if (page === 'ama' && amaSessions.length === 0) {
		emptyMessage = 'No AMA sessions yet.';
	}

	return (
		<Command.Dialog
			contentClassName="fixed left-1/2 top-[15vh] z-[60] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-on-secondary bg-card shadow-lg dark:border-on-secondary-dark dark:bg-card-dark"
			label="Jump to"
			loop
			onKeyDown={(event) => {
				// Backspace on an empty box steps out of a page. Escape keeps closing the whole palette: two
				// meanings for one key, depending on state nobody can see, is how a dialog gets stuck.
				if (page && search === '' && event.key === 'Backspace') {
					event.preventDefault();
					setPage(null);
				}
			}}
			onOpenChange={handleOpenChange}
			open={isOpen}
			overlayClassName="fixed inset-0 z-[60] bg-overlay"
		>
			<div className="flex items-center gap-3 border-b border-on-secondary px-4 py-3 text-secondary dark:border-on-secondary-dark dark:text-secondary-dark">
				<SvgSearch size={20} />
				{page === 'ama' && (
					<span className="shrink-0 rounded-md bg-on-tertiary px-2 py-0.5 text-sm font-medium text-primary dark:bg-on-tertiary-dark dark:text-primary-dark">
						AMA sessions
					</span>
				)}
				<Command.Input
					className="min-w-0 flex-1 bg-transparent text-lg text-primary outline-none placeholder:text-secondary dark:text-primary-dark dark:placeholder:text-secondary-dark"
					onValueChange={setSearch}
					placeholder={page === 'ama' ? 'Search AMA sessions...' : 'Jump to a section or server, or type a number...'}
					value={search}
				/>
				<Kbd>esc</Kbd>
			</div>

			<Command.List className="max-h-[min(60vh,480px)] overflow-y-auto p-1">
				{/* `Empty` renders whenever nothing matches, which during the first fetch would be "nothing" -- so
				    the two are exclusive. */}
				{page === 'ama' && isAmaLoading ? (
					<Command.Loading className="px-3 py-6 text-center text-sm text-secondary dark:text-secondary-dark">
						Loading sessions...
					</Command.Loading>
				) : (
					<Command.Empty className="px-3 py-6 text-center text-sm text-secondary dark:text-secondary-dark">
						{emptyMessage}
					</Command.Empty>
				)}

				{page === 'ama' && amaSessionsGroup}

				{page === null && (
					<>
						{guild && (jumps.length > 0 || jumpKinds.length > 0 || hasAma) && (
							<Command.Group className={GROUP_CLASS} heading="Go to">
								{/* The jumps a number in the box resolves to. `Case #42` scores against `42` and `case 42`
								    alike, and nothing else in the list contains a digit, so a typed number shows these alone. */}
								{jumps.map((jump) => (
									<PaletteItem
										icon={
											<BotIcon bot={jump.bot} branding={resolveBotBranding(guild, jump.bot)} height={20} width={20} />
										}
										key={jump.href}
										label={jump.label}
										onSelect={() => navigate(jump.href)}
										path={resolveBotBranding(guild, jump.bot).label}
										value={jump.label}
									/>
								))}
								{/* The kinds themselves, so the grammar is on screen: picking one types its word into the
								    box and leaves the number to you. They match `case`, not `case 42`, so they step aside
								    once a number is in play. */}
								{jumpKinds.map((kind) => (
									<PaletteItem
										icon={
											<BotIcon bot={kind.bot} branding={resolveBotBranding(guild, kind.bot)} height={20} width={20} />
										}
										key={kind.kind}
										keywords={[kind.kind, 'number']}
										label={`${kind.label} by number`}
										onSelect={() => setSearch(`${kind.kind} `)}
										path={resolveBotBranding(guild, kind.bot).label}
										value={`${kind.label} by number`}
									/>
								))}
								{hasAma && amaBranding && (
									<PaletteItem
										icon={<BotIcon bot="AMA" branding={amaBranding} height={20} width={20} />}
										keywords={['ama', 'session', 'name']}
										label="AMA by name"
										onSelect={() => openPage('ama')}
										path={amaBranding.label}
										value="AMA by name"
									/>
								)}
							</Command.Group>
						)}

						{search === '' && recents.length > 0 && (
							<Command.Group className={GROUP_CLASS} heading="Recent">
								{recents.map((recent) => (
									<PaletteItem
										icon={
											recent.bot ? (
												<BotIcon
													bot={recent.bot}
													branding={resolveBotBranding(
														guild && recent.guildId === guild.id ? guild : NO_BRANDING,
														recent.bot,
													)}
													height={20}
													width={20}
												/>
											) : (
												<FaWrench className="h-4 w-4" />
											)
										}
										key={recent.href}
										label={recent.label}
										onSelect={() => navigate(recent.href)}
										path={
											recent.guildId === guild?.id
												? recent.path
												: [recent.guildName, recent.path].filter(Boolean).join(' / ')
										}
										value={`recent ${recent.href}`}
									/>
								))}
							</Command.Group>
						)}

						{guild && canManage && (
							<Command.Group className={GROUP_CLASS} heading={guild.name}>
								<PaletteItem
									icon={<GuildIcon data={guild} disableLink hasBots size={20} />}
									keywords={['server', 'home']}
									label="Overview"
									onSelect={() => navigate(`/dashboard/${guild.id}`)}
									value={`${guild.name} overview`}
								/>
								<PaletteItem
									icon={<FaWrench className="h-4 w-4" />}
									keywords={['general']}
									label="Settings"
									onSelect={() => navigate(`/dashboard/${guild.id}/settings`)}
									value={`${guild.name} settings`}
								/>
							</Command.Group>
						)}

						{guild &&
							sectionGroups.map(({ bot, targets }) => {
								const branding = resolveBotBranding(guild, bot);
								return (
									<Fragment key={bot}>
										<Command.Group className={GROUP_CLASS} heading={branding.label}>
											{targets.map((target) => (
												<PaletteItem
													icon={<BotIcon bot={bot} branding={branding} height={20} width={20} />}
													key={target.href}
													// A custom instance (#216) is searchable by both its own label and the product's.
													keywords={[target.segment ?? 'hub', Bots[bot].label]}
													label={target.title}
													onSelect={() => navigate(target.href)}
													path={branding.label}
													value={`${branding.label} / ${target.title}`}
												/>
											))}
										</Command.Group>
										{bot === 'AMA' && search !== '' && amaSessionsGroup}
									</Fragment>
								);
							})}

						{otherGuilds.length > 0 && (
							<Command.Group className={GROUP_CLASS} heading="Servers">
								{otherGuilds.map((other, index) => (
									<PaletteItem
										icon={<GuildIcon data={other} disableLink hasBots size={20} />}
										key={other.id}
										keywords={['server']}
										label={other.name}
										onSelect={() => navigate(`/dashboard/${other.id}`)}
										value={otherGuildValues[index]!}
									/>
								))}
							</Command.Group>
						)}
					</>
				)}
			</Command.List>

			<div className="flex items-center gap-4 border-t border-on-secondary px-4 py-2 text-xs text-secondary dark:border-on-secondary-dark dark:text-secondary-dark">
				<span className="flex items-center gap-1.5">
					<Kbd>↑</Kbd>
					<Kbd>↓</Kbd> navigate
				</span>
				<span className="flex items-center gap-1.5">
					<Kbd>↵</Kbd> open
				</span>
				{page && (
					<span className="flex items-center gap-1.5">
						<Kbd>⌫</Kbd> back
					</span>
				)}
				<span className="flex items-center gap-1.5">
					<Kbd>esc</Kbd> close
				</span>
			</div>
		</Command.Dialog>
	);
}
