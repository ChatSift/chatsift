/**
 * The size every unfurler expects for a `summary_large_image`-style card, and its content type.
 *
 * Their own module rather than living in `og.tsx` beside the renderer, deliberately: that file pulls in
 * `next/og` and `node:fs`, and the apps' `utils/site.ts` -- which every page's metadata imports -- has no
 * business carrying either just to know how big a card is. `og.tsx` imports them from here.
 */
export const OG_SIZE = { width: 1_200, height: 630 } as const;

export const OG_CONTENT_TYPE = 'image/png';
