interface PreviewEmbed {
	readonly color?: number | undefined;
	readonly description?: string | undefined;
	readonly imageURL?: string | undefined;
	readonly thumbnailURL?: string | undefined;
	readonly title?: string | undefined;
}

interface PreviewResult {
	readonly content?: string | undefined;
	readonly embed?: PreviewEmbed | undefined;
	readonly error?: string | undefined;
}

interface NormalPreviewProps {
	readonly description: string;
	readonly imageURL: string;
	readonly mode: 'normal';
	readonly plainText: string;
	readonly thumbnailURL: string;
	readonly title: string;
}

interface RawPreviewProps {
	readonly mode: 'raw';
	readonly raw: string;
}

type PromptPreviewProps = NormalPreviewProps | RawPreviewProps;

// Matches the hardcoded embed color in `services/api/src/routes/ama/createAMA.ts` — keep this preview honest with
// what actually gets posted.
const EMBED_COLOR = '#7289da';

function isValidURL(value: string | undefined): value is string {
	if (!value) return false;

	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

function parseRawEmbed(raw: string): PreviewResult {
	if (!raw.trim()) {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: "Can't preview — invalid JSON" };
	}

	if (typeof parsed !== 'object' || parsed === null) {
		return { error: "Can't preview — expected a JSON object" };
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
		return { error: 'Can\'t preview — "embeds" must be a non-empty array' };
	}

	const firstEmbed = embeds[0];
	if (typeof firstEmbed !== 'object' || firstEmbed === null) {
		return { error: "Can't preview — embeds[0] must be an object" };
	}

	const embedRecord = firstEmbed as Record<string, unknown>;
	const image = embedRecord['image'] as Record<string, unknown> | undefined;
	const thumbnail = embedRecord['thumbnail'] as Record<string, unknown> | undefined;

	return {
		content,
		embed: {
			title: typeof embedRecord['title'] === 'string' ? embedRecord['title'] : undefined,
			description: typeof embedRecord['description'] === 'string' ? embedRecord['description'] : undefined,
			imageURL: typeof image?.['url'] === 'string' ? image['url'] : undefined,
			thumbnailURL: typeof thumbnail?.['url'] === 'string' ? thumbnail['url'] : undefined,
			color: typeof embedRecord['color'] === 'number' ? embedRecord['color'] : undefined,
		},
	};
}

function resolvePreview(props: PromptPreviewProps): PreviewResult {
	if (props.mode === 'raw') {
		return parseRawEmbed(props.raw);
	}

	return {
		content: props.plainText || undefined,
		embed: {
			title: props.title || undefined,
			description: props.description || undefined,
			imageURL: isValidURL(props.imageURL) ? props.imageURL : undefined,
			thumbnailURL: isValidURL(props.thumbnailURL) ? props.thumbnailURL : undefined,
		},
	};
}

export function PromptPreview(props: PromptPreviewProps) {
	const { content, embed, error } = resolvePreview(props);
	const hasEmbedContent =
		Boolean(embed?.title) || Boolean(embed?.description) || Boolean(embed?.imageURL) || Boolean(embed?.thumbnailURL);

	return (
		<div className="rounded-md border border-on-secondary bg-[#313338] p-4 dark:border-on-secondary-dark">
			<p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Prompt preview</p>

			{error ? (
				<p className="text-sm text-white/50">{error}</p>
			) : content || hasEmbedContent ? (
				<div className="space-y-2">
					{content && <p className="whitespace-pre-wrap text-sm text-[#dbdee1]">{content}</p>}

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
									<p className="whitespace-pre-wrap text-sm text-[#dbdee1]">{embed.description}</p>
								)}
								{embed?.imageURL && (
									// eslint-disable-next-line @next/next/no-img-element
									<img alt="" className="mt-2 max-h-64 max-w-full rounded" src={embed.imageURL} />
								)}
							</div>
							{embed?.thumbnailURL && (
								// eslint-disable-next-line @next/next/no-img-element
								<img alt="" className="h-16 w-16 shrink-0 rounded object-cover" src={embed.thumbnailURL} />
							)}
						</div>
					)}
				</div>
			) : (
				<p className="text-sm text-white/50">Nothing to preview yet.</p>
			)}
		</div>
	);
}
