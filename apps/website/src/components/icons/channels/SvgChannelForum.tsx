interface SvgChannelForumProps {
	readonly className?: string;
	readonly size?: number;
}

export function SvgChannelForum({ className, size = 20 }: SvgChannelForumProps) {
	return (
		<svg
			className={className}
			fill="none"
			height={size}
			viewBox="0 0 22 24"
			width={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M3.5 4C2.4 4 1.5 4.9 1.5 6V14C1.5 15.1 2.4 16 3.5 16H6V18.8C6 19.35 6.45 19.8 7 19.8C7.22 19.8 7.43 19.73 7.6 19.6L11.2 16.5H18.5C19.6 16.5 20.5 15.6 20.5 14.5V6C20.5 4.9 19.6 4 18.5 4H3.5ZM18.5 14.5H11L8 16.8V14.5H3.5V6H18.5V14.5Z"
				fill="currentColor"
			/>
		</svg>
	);
}
