import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { OG_SIZE, SITE_NAME } from './site';

// Literal copies of the `@theme` tokens in `styles/globals.css` -- Satori resolves neither CSS custom
// properties nor Tailwind classes, so the card can't reference the real tokens. Update both together.
const COLOR_BASE = '#f1f2f5';
const COLOR_PRIMARY = '#1d274e';
const COLOR_SECONDARY = 'rgba(29, 39, 78, 0.75)';
const COLOR_ACCENT = '#2f8fee';

/**
 * The mark from `components/icons/SvgChatSift.tsx`, with its `stroke-misc-accent`/`stroke-primary` classes
 * resolved to literals (see above) and inlined as a data URI. Satori's `<img>` handling is far more reliable
 * than its partial inline-`<svg>` support, and a data URI keeps this off the filesystem entirely -- no
 * `public/` read to trace into the Vercel lambda. Keep the two `d` attributes in sync with the component.
 */
const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(
	`<svg fill="none" height="48" viewBox="0 0 48 48" width="48" xmlns="http://www.w3.org/2000/svg">` +
		`<path d="M14 24V30H20L24 34L28 30H34V24" stroke="${COLOR_ACCENT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>` +
		`<path d="M14 16H34M18.5 21H29.5M22.5 26H25.5" stroke="${COLOR_PRIMARY}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>` +
		`</svg>`,
).toString('base64')}`;

interface OgFont {
	data: ArrayBuffer | Buffer;
	name: string;
	style: 'normal';
	weight: 400 | 600;
}

/**
 * Author is the site's brand font (`styles/author.css`), and Satori needs the raw `.ttf` rather than the
 * `.woff2` the browser loads. `outputFileTracingIncludes` in `next.config.mjs` is what gets these two files
 * into the serverless bundle -- Next's tracer can't see through a `process.cwd()` read on its own.
 *
 * Failing to load them is deliberately not fatal: `ImageResponse` falls back to its own bundled font, so a
 * tracing miss degrades to an off-brand-but-working card instead of 500ing every unfurl.
 */
async function loadFonts(): Promise<OgFont[] | undefined> {
	try {
		const [regular, semibold] = await Promise.all([
			readFile(join(process.cwd(), 'public/assets/fonts/Author-Regular.ttf')),
			readFile(join(process.cwd(), 'public/assets/fonts/Author-Semibold.ttf')),
		]);

		return [
			{ name: 'Author', data: regular, weight: 400, style: 'normal' },
			{ name: 'Author', data: semibold, weight: 600, style: 'normal' },
		];
	} catch (error) {
		console.error('failed to load OG card fonts, falling back to the built-in one', error);
		return undefined;
	}
}

/**
 * Satori supports no line clamping, and an overlong title would otherwise push the rest of the card out of
 * frame -- so anything that can be user-supplied (an AMA's title, up to 255 chars) is cut down here instead.
 */
function truncate(text: string, max: number): string {
	const collapsed = text.replaceAll(/\s+/gu, ' ').trim();
	return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed;
}

export interface OgCardOptions {
	/**
	 * Small tinted label above the title, naming the surface this card is for (e.g. `AMA`). Omitted on the
	 * site-wide card, where the wordmark already says everything.
	 */
	readonly eyebrow?: string;
	readonly subtitle: string;
	readonly title: string;
}

/**
 * The one card layout every `opengraph-image` route in the app renders, so a ChatSift link unfurls the same
 * way regardless of which page it points at.
 */
export async function renderOgCard({ eyebrow, subtitle, title }: OgCardOptions): Promise<ImageResponse> {
	const fonts = await loadFonts();

	return new ImageResponse(
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'space-between',
				backgroundColor: COLOR_BASE,
				fontFamily: fonts ? 'Author' : undefined,
				padding: '72px 80px',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
				{/* eslint-disable-next-line @next/next/no-img-element -- Satori JSX, not the DOM: `next/image` has no meaning here. */}
				<img alt="" height={96} src={LOGO_DATA_URI} width={96} />
				<span style={{ fontSize: 52, fontWeight: 600, color: COLOR_PRIMARY }}>{SITE_NAME}</span>
			</div>

			<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
				{eyebrow ? (
					<span style={{ fontSize: 28, fontWeight: 600, letterSpacing: 2, color: COLOR_ACCENT }}>
						{truncate(eyebrow.toUpperCase(), 40)}
					</span>
				) : null}
				<span style={{ fontSize: 68, fontWeight: 600, lineHeight: 1.1, color: COLOR_PRIMARY }}>
					{truncate(title, 90)}
				</span>
				<span style={{ fontSize: 32, fontWeight: 400, lineHeight: 1.35, color: COLOR_SECONDARY }}>
					{truncate(subtitle, 140)}
				</span>
			</div>

			<div style={{ display: 'flex', width: 200, height: 10, borderRadius: 5, backgroundColor: COLOR_ACCENT }} />
		</div>,
		{
			...OG_SIZE,
			...(fonts && { fonts }),
			// A card is only ever meant to be seen inside someone else's embed, never as a search result of its
			// own. Matters most for the AMA share page: its `noindex` lives in a meta tag, which an image
			// response has nowhere to put -- and `app/robots.ts` deliberately doesn't disallow that path, so
			// this header is what keeps the card out of image search alongside it.
			headers: { 'X-Robots-Tag': 'noindex' },
		},
	);
}
