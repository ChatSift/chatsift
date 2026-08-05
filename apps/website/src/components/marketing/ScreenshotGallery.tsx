import Image from 'next/image';
import { EmptyState } from '@/components/common/EmptyState';
import { SvgChatSift } from '@/components/icons/SvgChatSift';
import type { MarketingScreenshot } from '@/data/marketingBots';

interface ScreenshotGalleryProps {
	readonly botName: string;
	readonly screenshots: readonly MarketingScreenshot[];
}

/**
 * A horizontally scroll-snapped image row -- deliberately not a stateful carousel (no prev/next buttons, no
 * client-side index), so this renders and works identically with JavaScript disabled, matching the marketing
 * area's no-JS requirement carried over from the old site.
 */
export function ScreenshotGallery({ screenshots, botName }: ScreenshotGalleryProps) {
	if (screenshots.length === 0) {
		return <EmptyState icon={<SvgChatSift />} title="Screenshots coming soon" />;
	}

	return (
		<div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
			{screenshots.map((screenshot) => (
				<Image
					alt={screenshot.alt || `${botName} screenshot`}
					className="h-auto w-[300px] shrink-0 snap-center rounded-lg border border-on-secondary dark:border-on-secondary-dark"
					height={500}
					key={screenshot.src}
					src={screenshot.src}
					width={300}
				/>
			))}
		</div>
	);
}
