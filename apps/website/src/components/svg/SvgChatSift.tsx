import type { SVGProps } from 'react';

export default function SvgChatSift(props: SVGProps<SVGSVGElement>) {
	return (
		<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
			<path
				d="M4.5 12V16.5H9L12 19.5L15 16.5H19.5V12"
				className="stroke-accent"
				strokeWidth="1.875"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M4.5 6H19.5M7.875 9.75H16.125M10.875 13.5H13.125"
				className="stroke-primary"
				strokeWidth="1.875"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
