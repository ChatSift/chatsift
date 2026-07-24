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

	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img alt={name} className={className} src={`https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`} />
	);
}
