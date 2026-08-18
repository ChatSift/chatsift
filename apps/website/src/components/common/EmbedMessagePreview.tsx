'use client';

import type { BotId } from '@chatsift/core';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Button } from '@/components/common/Button';
import { DEFAULT_EMBED_COLOR_HEX, hexToColor } from '@/components/common/ColorField';
import { Skeleton } from '@/components/common/Skeleton';

// `ssr: false` is load-bearing -- see `DiscordMarkdown.tsx`'s own doc comment on why its wasm parser can't
// be evaluated server-side at all under Next's bundler.
const DiscordMarkdown = dynamic(
	async () => {
		const mod = await import('@/components/common/DiscordMarkdown');
		return mod.DiscordMarkdown;
	},
	{
		loading: () => <Skeleton className="h-4 w-48" />,
		ssr: false,
	},
);

interface PreviewEmbed {
	readonly color?: number | undefined;
	readonly description?: string | undefined;
	readonly imageUrl?: string | undefined;
	readonly thumbnailUrl?: string | undefined;
	readonly title?: string | undefined;
}

interface PreviewResult {
	readonly content?: string | undefined;
	readonly embed?: PreviewEmbed | undefined;
	readonly error?: string | undefined;
}

/**
 * What differs between the features that post a configurable embed + button message: the heading above the
 * preview, which bot's emoji/mention resolution `DiscordMarkdown` should use, and the button label a raw-mode
 * message falls back to (raw mode has no configurable label, since the button is appended server-side).
 */
interface PreviewChromeProps {
	readonly defaultButtonLabel: string;
	readonly forBot: BotId;
	readonly heading: string;
}

interface NormalPreviewProps extends PreviewChromeProps {
	readonly buttonLabel: string;
	/**
	 * `#rrggbb`, or empty for "use the default".
	 */
	readonly color: string;
	readonly description: string;
	readonly imageUrl: string;
	readonly mode: 'normal';
	readonly thumbnailUrl: string;
	readonly title: string;
}

interface RawPreviewProps extends PreviewChromeProps {
	readonly mode: 'raw';
	readonly raw: string;
}

type EmbedMessagePreviewProps = NormalPreviewProps | RawPreviewProps;

// Shared with every create route's own fallback, so this preview stays honest with what actually gets posted
// when no color is picked.
const EMBED_COLOR = DEFAULT_EMBED_COLOR_HEX;

function parseRawMessage(raw: string): PreviewResult {
	if (!raw.trim()) {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: "Can't preview - invalid JSON" };
	}

	if (typeof parsed !== 'object' || parsed === null) {
		return { error: "Can't preview - expected a JSON object" };
	}

	const body = parsed as Record<string, unknown>;
	const content = typeof body['content'] === 'string' ? body['content'] : undefined;

	const embeds = body['embeds'];

	// No `embeds` key at all is valid -- a content-only message. But if it's present, it must actually be the
	// documented shape; silently dropping a malformed value here (instead of erroring) is exactly what made the
	// embed look like it "didn't render" for no visible reason.
	if (embeds === undefined) {
		return { content };
	}

	if (!Array.isArray(embeds) || embeds.length === 0) {
		return { error: 'Can\'t preview - "embeds" must be a non-empty array' };
	}

	const firstEmbed = embeds[0];
	if (typeof firstEmbed !== 'object' || firstEmbed === null) {
		return { error: "Can't preview - embeds[0] must be an object" };
	}

	const embedRecord = firstEmbed as Record<string, unknown>;
	const image = embedRecord['image'] as Record<string, unknown> | undefined;
	const thumbnail = embedRecord['thumbnail'] as Record<string, unknown> | undefined;

	return {
		content,
		embed: {
			title: typeof embedRecord['title'] === 'string' ? embedRecord['title'] : undefined,
			description: typeof embedRecord['description'] === 'string' ? embedRecord['description'] : undefined,
			color: typeof embedRecord['color'] === 'number' ? embedRecord['color'] : undefined,
			imageUrl: typeof image?.['url'] === 'string' ? image['url'] : undefined,
			thumbnailUrl: typeof thumbnail?.['url'] === 'string' ? thumbnail['url'] : undefined,
		},
	};
}

function resolvePreview(props: EmbedMessagePreviewProps): PreviewResult {
	if (props.mode === 'raw') {
		return parseRawMessage(props.raw);
	}

	return {
		embed: {
			title: props.title || undefined,
			description: props.description || undefined,
			imageUrl: props.imageUrl || undefined,
			thumbnailUrl: props.thumbnailUrl || undefined,
			// `?? undefined` so a half-typed hex previews as the default rather than flickering to black --
			// same value the API would fall back to for that (rejected) input anyway.
			color: hexToColor(props.color) ?? undefined,
		},
	};
}

export function EmbedMessagePreview(props: EmbedMessagePreviewProps) {
	const { content, embed, error } = resolvePreview(props);
	const hasEmbedContent =
		Boolean(embed?.title) || Boolean(embed?.description) || Boolean(embed?.imageUrl) || Boolean(embed?.thumbnailUrl);
	// A raw-mode message always gets its button appended server-side with a fixed label -- only normal mode has
	// a user-configurable one.
	const buttonLabel = (props.mode === 'normal' && props.buttonLabel.trim()) || props.defaultButtonLabel;
	// Rendering an `<img>` fetches it immediately -- gate behind an explicit click the same way
	// `SnippetCard` does, since this is a staff-pasted URL nobody here has vetted. Tracks *which* URLs were
	// approved (image and thumbnail are approved separately) so editing to a different image always
	// requires a fresh click.
	const [previewedUrls, setPreviewedUrls] = useState<readonly string[]>([]);
	const approveUrl = (url: string) => setPreviewedUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));

	return (
		<div className="rounded-md border border-on-secondary bg-[#313338] p-4 dark:border-on-secondary-dark">
			<p className="mb-2 text-xs font-medium uppercase tracking-wide text-accent/40">{props.heading}</p>

			{error ? (
				<p className="text-sm text-accent/50">{error}</p>
			) : (
				<div className="space-y-2">
					{content && (
						<div className="whitespace-pre-wrap text-sm text-[#dbdee1]">
							<DiscordMarkdown content={content} forBot={props.forBot} />
						</div>
					)}

					{hasEmbedContent && (
						<div
							className="flex gap-3 rounded border-l-4 bg-[#2b2d31] p-3"
							style={{
								borderColor: embed?.color === undefined ? EMBED_COLOR : `#${embed.color.toString(16).padStart(6, '0')}`,
							}}
						>
							<div className="min-w-0 flex-1 space-y-1">
								{embed?.title && <p className="text-sm font-semibold text-[#f2f3f5]">{embed.title}</p>}
								{embed?.description && (
									<div className="whitespace-pre-wrap text-sm text-[#dbdee1]">
										<DiscordMarkdown content={embed.description} forBot={props.forBot} />
									</div>
								)}
								{embed?.imageUrl &&
									(previewedUrls.includes(embed.imageUrl) ? (
										// eslint-disable-next-line @next/next/no-img-element -- arbitrary staff-pasted external URL, not one of the app's known image sources Next's optimizer can proxy
										<img
											alt="Embed"
											className="max-h-40 rounded-md border border-on-secondary dark:border-on-secondary-dark"
											src={embed.imageUrl}
										/>
									) : (
										<Button
											className="h-fit p-0 text-xs text-accent/50 underline hover:bg-transparent"
											onPress={() => approveUrl(embed.imageUrl!)}
										>
											Show image preview
										</Button>
									))}
							</div>
							{embed?.thumbnailUrl &&
								(previewedUrls.includes(embed.thumbnailUrl) ? (
									// eslint-disable-next-line @next/next/no-img-element -- arbitrary staff-pasted external URL, not one of the app's known image sources Next's optimizer can proxy
									<img
										alt="Embed thumbnail"
										className="h-16 w-16 shrink-0 rounded object-cover"
										src={embed.thumbnailUrl}
									/>
								) : (
									<Button
										className="h-fit shrink-0 p-0 text-xs text-accent/50 underline hover:bg-transparent"
										onPress={() => approveUrl(embed.thumbnailUrl!)}
									>
										Show thumbnail
									</Button>
								))}
						</div>
					)}

					<button className="rounded bg-[#5865f2] px-4 py-1.5 text-sm font-medium text-accent" disabled type="button">
						{buttonLabel}
					</button>
				</div>
			)}
		</div>
	);
}
