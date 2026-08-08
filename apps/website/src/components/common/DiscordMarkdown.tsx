'use client';

import type { BotId } from '@chatsift/core';
import type {
	BoldProps,
	CodeBlockProps,
	CodeProps,
	EmojiProps,
	EmptyProps,
	HeadingProps,
	ItalicProps,
	LinkProps,
	ListItemProps,
	ListProps,
	MentionProps,
	ParagraphProps,
	QuoteProps,
	Renderers,
	SmallProps,
	SpoilerProps,
	StrikethroughProps,
	TextProps,
	TimestampProps,
	UnderlineProps,
} from '@discord/markdown-react';
import { NodeList } from '@discord/markdown-react';
import { parse } from '@discord/markdown-wasm/sync';
import type { APIUser, Snowflake } from '@discordjs/core';
import { useParams } from 'next/navigation';
import { createContext, useContext, useMemo, useState } from 'react';
import { useGuildInfo } from '@/api/routes/guilds';
import { cn, formatDate } from '@/utils/util';

function participantLabel(entry: APIUser | Snowflake | undefined, fallbackId: string): string {
	if (!entry) {
		return fallbackId;
	}

	return typeof entry === 'string' ? entry : (entry.global_name ?? entry.username);
}

interface DiscordMarkdownContextValue {
	readonly participants: Record<string, APIUser | Snowflake>;
	readonly roles: { id: string; name: string }[];
}

const DiscordMarkdownContext = createContext<DiscordMarkdownContextValue>({ participants: {}, roles: [] });

function BoldRenderer({ children }: BoldProps) {
	return <strong>{children}</strong>;
}

function ItalicRenderer({ children }: ItalicProps) {
	return <em>{children}</em>;
}

function UnderlineRenderer({ children }: UnderlineProps) {
	return <span className="underline">{children}</span>;
}

function StrikethroughRenderer({ children }: StrikethroughProps) {
	return <span className="line-through">{children}</span>;
}

function SpoilerRenderer({ children }: SpoilerProps) {
	const [revealed, setRevealed] = useState(false);

	return (
		<span
			className={cn(
				'cursor-pointer rounded px-1',
				revealed
					? 'bg-on-tertiary dark:bg-on-tertiary-dark'
					: 'select-none bg-primary text-primary dark:bg-primary-dark dark:text-primary-dark',
			)}
			onClick={() => setRevealed(true)}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					setRevealed(true);
				}
			}}
			role="button"
			tabIndex={0}
		>
			{children}
		</span>
	);
}

function CodeRenderer({ children }: CodeProps) {
	return (
		<code className="rounded bg-on-tertiary px-1 py-0.5 font-mono text-[0.85em] dark:bg-on-tertiary-dark">
			{children}
		</code>
	);
}

function CodeBlockRenderer({ content }: CodeBlockProps) {
	return (
		<pre className="my-1 overflow-x-auto rounded bg-on-tertiary p-2 font-mono text-xs dark:bg-on-tertiary-dark">
			<code>{content}</code>
		</pre>
	);
}

function HeadingRenderer({ level, children }: HeadingProps) {
	if (level === 1) {
		return <h1 className="text-lg font-semibold">{children}</h1>;
	}

	if (level === 2) {
		return <h2 className="text-base font-semibold">{children}</h2>;
	}

	return <h3 className="text-sm font-semibold">{children}</h3>;
}

function QuoteRenderer({ children }: QuoteProps) {
	return (
		<blockquote className="my-1 border-l-2 border-on-secondary pl-2 text-secondary dark:border-on-secondary-dark dark:text-secondary-dark">
			{children}
		</blockquote>
	);
}

function SmallRenderer({ children }: SmallProps) {
	return <span className="text-xs text-secondary dark:text-secondary-dark">{children}</span>;
}

function ListRenderer({ type, value, children }: ListProps) {
	if (type === 'ordered') {
		return (
			<ol className="my-1 list-inside list-decimal" start={value}>
				{children}
			</ol>
		);
	}

	return <ul className="my-1 list-inside list-disc">{children}</ul>;
}

function ListItemRenderer({ children }: ListItemProps) {
	return <li>{children}</li>;
}

function EmptyRenderer(_props: EmptyProps) {
	return null;
}

function ParagraphRenderer({ children }: ParagraphProps) {
	return <div>{children}</div>;
}

function TextRenderer({ children }: TextProps) {
	return <>{children}</>;
}

function TimestampRenderer({ value }: TimestampProps) {
	const date = new Date(Number(value) * 1_000);
	return (
		<span
			className="rounded bg-on-tertiary px-1 text-primary dark:bg-on-tertiary-dark dark:text-primary-dark"
			title={date.toISOString()}
		>
			{formatDate(date)}
		</span>
	);
}

function EmojiRenderer(props: EmojiProps) {
	if (props.type === 'unicode') {
		return <>{props.value}</>;
	}

	const { animated, id, name } = props.value;
	const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=32`;
	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img alt={`:${name}:`} className="inline-block h-5 w-5 align-text-bottom" src={url} title={`:${name}:`} />
	);
}

const MENTION_CLASSNAME = 'rounded bg-misc-accent/20 px-1 text-misc-accent';

function MentionRenderer(props: MentionProps) {
	const { participants, roles } = useContext(DiscordMarkdownContext);

	switch (props.type) {
		case 'everyone':
			return <span className={MENTION_CLASSNAME}>@everyone</span>;
		case 'here':
			return <span className={MENTION_CLASSNAME}>@here</span>;
		case 'user': {
			const id = props.value.toString();
			return <span className={MENTION_CLASSNAME}>@{participantLabel(participants[id], id)}</span>;
		}

		case 'role': {
			const id = props.value.toString();
			const role = roles.find((candidate) => candidate.id === id);
			return <span className={MENTION_CLASSNAME}>@{role?.name ?? id}</span>;
		}

		case 'channel':
			// The bot never fetches a guild's full channel list, so an in-message channel mention can only
			// ever render as a generic id reference -- same best-effort limitation as `getThread.ts`'s own
			// enrichment (roles/tags/members), never a hard failure.
			return <span className={MENTION_CLASSNAME}>#{props.value.toString()}</span>;
		case 'command':
			return <span className={MENTION_CLASSNAME}>/{props.value.name}</span>;
		default:
			return <span className={MENTION_CLASSNAME}>@mention</span>;
	}
}

function LinkRenderer(props: LinkProps) {
	if (props.type === 'normal') {
		return (
			<a
				className="text-misc-accent hover:underline"
				href={props.value.url}
				rel="noreferrer"
				target="_blank"
				title={props.value.title}
			>
				{props.children ?? props.value.url}
			</a>
		);
	}

	// A pasted Discord message/channel/attachment url -- rendered as a plain chip rather than resolved
	// further (rare in mod messages, and resolving it would mean fetching yet another message/channel).
	return <span className={cn(MENTION_CLASSNAME, 'cursor-default')}>{props.children ?? 'link'}</span>;
}

const renderers: Renderers = {
	bold: BoldRenderer,
	code: CodeRenderer,
	code_block: CodeBlockRenderer,
	emoji: EmojiRenderer,
	empty: EmptyRenderer,
	heading: HeadingRenderer,
	italic: ItalicRenderer,
	link: LinkRenderer,
	list: ListRenderer,
	listItem: ListItemRenderer,
	mention: MentionRenderer,
	paragraph: ParagraphRenderer,
	quote: QuoteRenderer,
	small: SmallRenderer,
	strikethrough: StrikethroughRenderer,
	text: TextRenderer,
	timestamp: TimestampRenderer,
	underline: UnderlineRenderer,
};

interface DiscordMarkdownProps {
	readonly content: string;
	/**
	 * Which bot to resolve the guild's role list against (for `@role` mentions) -- the roles themselves aren't
	 * bot-specific, but `useGuildInfo` requires a `for_bot` to authorize the guild-info fetch.
	 */
	readonly forBot: BotId;
	readonly participants?: Record<string, APIUser | Snowflake> | undefined;
}

/**
 * Renders Discord message content the way Discord actually would -- mentions/emoji/timestamps/formatting,
 * not just plain text (Phase 3, #261; extended to dashboard "preview" surfaces in #301). Uses Discord's own
 * official `@discord/markdown-react` + `@discord/markdown-wasm` packages rather than hand-rolling a parser --
 * their AST node coverage (mentions, custom/unicode emoji, timestamps, spoilers, code, lists, quotes)
 * matches exactly what the bot's constrained message shape (plain markdown, at most one embed, no
 * reactions/polls/components) can contain. Embeds are deliberately out of scope here -- nothing records
 * embed data at all for recorded ModMail history (see docs/roadmap/07-modmail-thread-history.md), and
 * preview surfaces render their embed fields separately -- so there's nothing for a renderer to render.
 *
 * `@discord/markdown-wasm/sync`'s top-level `await` (loading its wasm binary the moment the module is
 * evaluated) breaks under Next's *server* bundle -- its Node-side loader does `fs.readFile(new URL(...))`,
 * and the `URL` instance the bundler's transform produces isn't the same `URL` Node's `fs` module validates
 * against. This component must never be evaluated during SSR as a result -- see the `next/dynamic(...,
 * { ssr: false })` wrapper at every import site (`ThreadMessage.tsx`, `PromptPreview.tsx`, `PanelPreview.tsx`,
 * `SnippetCard.tsx`) rather than importing this file directly.
 */
export function DiscordMarkdown({ content, participants = {}, forBot }: DiscordMarkdownProps) {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: guildInfo } = useGuildInfo(guildId, forBot);
	const ast = useMemo(() => parse(content), [content]);
	const contextValue = useMemo(
		() => ({ participants, roles: guildInfo?.roles ?? [] }),
		[participants, guildInfo?.roles],
	);

	return (
		<DiscordMarkdownContext.Provider value={contextValue}>
			<NodeList nodes={ast} renderers={renderers} />
		</DiscordMarkdownContext.Provider>
	);
}
