interface SvgChannelCategoryProps {
	readonly className?: string;
	readonly size?: number;
}

export function SvgChannelCategory({ className, size = 20 }: SvgChannelCategoryProps) {
	return (
		<svg
			className={className}
			fill="none"
			height={size}
			viewBox="0 0 24 24"
			width={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M7 2L5 2C3.89543 2 3 2.89543 3 4L3 6C3 7.10457 3.89543 8 5 8L7 8C8.10457 8 9 7.10457 9 6L9 4C9 2.89543 8.10457 2 7 2Z"
				fill="currentColor"
			/>
			<path
				d="M7 10L5 10C3.89543 10 3 10.8954 3 12L3 14C3 15.1046 3.89543 16 5 16L7 16C8.10457 16 9 15.1046 9 14L9 12C9 10.8954 8.10457 10 7 10Z"
				fill="currentColor"
			/>
			<path
				d="M7 18L5 18C3.89543 18 3 18.8954 3 20L3 22C3 23.1046 3.89543 24 5 24L7 24C8.10457 24 9 23.1046 9 22L9 20C9 18.8954 8.10457 18 7 18Z"
				fill="currentColor"
				opacity="0.6"
			/>
			<path
				d="M15 2L13 2C11.8954 2 11 2.89543 11 4L11 6C11 7.10457 11.8954 8 13 8L15 8C16.1046 8 17 7.10457 17 6L17 4C17 2.89543 16.1046 2 15 2Z"
				fill="currentColor"
			/>
			<path
				d="M15 10L13 10C11.8954 10 11 10.8954 11 12L11 14C11 15.1046 11.8954 16 13 16L15 16C16.1046 16 17 15.1046 17 14L17 12C17 10.8954 16.1046 10 15 10Z"
				fill="currentColor"
			/>
			<path
				d="M15 18L13 18C11.8954 18 11 18.8954 11 20L11 22C11 23.1046 11.8954 24 13 24L15 24C16.1046 24 17 23.1046 17 22L17 20C17 18.8954 16.1046 18 15 18Z"
				fill="currentColor"
				opacity="0.6"
			/>
			<path d="M19 5L22 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
		</svg>
	);
}
