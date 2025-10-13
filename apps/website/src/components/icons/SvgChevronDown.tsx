interface SvgChevronDownProps {
	readonly className?: string;
	readonly size?: number;
}

export function SvgChevronDown({ className, size = 16 }: SvgChevronDownProps) {
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
			<path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}
