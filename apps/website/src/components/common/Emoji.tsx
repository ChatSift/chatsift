// Matches Discord's own shorthand for a custom guild emoji (`<:name:id>`, `<a:name:id>` for animated) -- the
// same shape `EmojiInput.tsx` writes into `Category.emoji` when a custom emoji is picked. A unicode emoji stored
// in that field doesn't match this and is rendered as plain text instead, since it already renders natively.
const CUSTOM_EMOJI_REGEX = /^<(?<animated>a)?:(?<name>\w{2,32}):(?<id>\d{17,20})>$/;

interface EmojiProps {
	readonly className?: string;
	readonly value: string;
}

export function Emoji({ value, className }: EmojiProps) {
	const match = CUSTOM_EMOJI_REGEX.exec(value);
	if (!match?.groups) {
		return <span className={className}>{value}</span>;
	}

	const { animated, name, id } = match.groups;

	// `.webp` always resolves regardless of source format, unlike `.gif` -- some animated custom emotes
	// are natively webp-sourced rather than gif-sourced, and Discord's CDN 404s a `.gif` request for
	// those (issue #234). `?animated=true` is required for webp to actually play back the animation
	// instead of a static first frame.
	const src = animated
		? `https://cdn.discordapp.com/emojis/${id}.webp?animated=true`
		: `https://cdn.discordapp.com/emojis/${id}.png`;

	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img alt={name} className={className} src={src} />
	);
}
