interface SvgSearchProps {
	readonly className?: string;
	readonly size?: number;
}

export function SvgSearch({ className, size = 16 }: SvgSearchProps) {
	return (
		<svg
			className={className}
			fill="none"
			height={size}
			stroke="currentColor"
			strokeWidth={2}
			viewBox="0 0 24 24"
			width={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<circle cx="11" cy="11" r="7" />
			<path d="M20 20l-3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}
