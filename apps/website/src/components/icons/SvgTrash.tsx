interface SvgTrashProps {
	readonly className?: string;
	readonly size?: number;
}

export function SvgTrash({ className, size = 16 }: SvgTrashProps) {
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
			<path
				d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
