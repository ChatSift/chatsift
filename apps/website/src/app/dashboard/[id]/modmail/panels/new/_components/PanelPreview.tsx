interface PreviewEmbed {
	readonly color?: number | undefined;
	readonly description?: string | undefined;
	readonly title?: string | undefined;
}

interface PreviewResult {
	readonly content?: string | undefined;
	readonly embed?: PreviewEmbed | undefined;
	readonly error?: string | undefined;
}

interface NormalPreviewProps {
	readonly buttonLabel: string;
	readonly description: string;
	readonly mode: 'normal';
	readonly title: string;
}

interface RawPreviewProps {
	readonly mode: 'raw';
	readonly raw: string;
}

type PanelPreviewProps = NormalPreviewProps | RawPreviewProps;

// Matches the hardcoded embed color in `services/api/src/routes/modmail/panels/createPanel.ts` -- keep this
// preview honest with what actually gets posted.
const EMBED_COLOR = '#7289da';

function parseRawPanel(raw: string): PreviewResult {
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

	return {
		content,
		embed: {
			title: typeof embedRecord['title'] === 'string' ? embedRecord['title'] : undefined,
			description: typeof embedRecord['description'] === 'string' ? embedRecord['description'] : undefined,
			color: typeof embedRecord['color'] === 'number' ? embedRecord['color'] : undefined,
		},
	};
}

function resolvePreview(props: PanelPreviewProps): PreviewResult {
	if (props.mode === 'raw') {
		return parseRawPanel(props.raw);
	}

	return {
		embed: {
			title: props.title || undefined,
			description: props.description || undefined,
		},
	};
}

export function PanelPreview(props: PanelPreviewProps) {
	const { content, embed, error } = resolvePreview(props);
	const hasEmbedContent = Boolean(embed?.title) || Boolean(embed?.description);
	// Raw-mode panels always get the fixed "Create Ticket" button server-side (see createPanel.ts) -- only
	// normal-mode panels have a user-configurable label.
	const buttonLabel = (props.mode === 'normal' && props.buttonLabel.trim()) || 'Create Ticket';

	return (
		<div className="rounded-md border border-on-secondary bg-[#313338] p-4 dark:border-on-secondary-dark">
			<p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Panel preview</p>

			{error ? (
				<p className="text-sm text-white/50">{error}</p>
			) : (
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
							</div>
						</div>
					)}

					<button className="rounded bg-[#5865f2] px-4 py-1.5 text-sm font-medium text-white" disabled type="button">
						{buttonLabel}
					</button>
				</div>
			)}
		</div>
	);
}
