import type { CSSProperties } from 'react';

/**
 * The Chainsea brand mark (public/brand/chainsea-logo.png, phase 5 of
 * docs/change-requests/sidebar-position.md), on the login, invitation, admin sidebar and portal
 * headers next to the Chainseabase name.
 *
 * The original PNG is used as delivered (1800 × 1800, transparent, not cropped or re-encoded). Its
 * visible mark only spans x 352–1452, y 345–1453, so the image is drawn larger and centred on that
 * mark: `size` is the size of the visible logo, and only transparent pixels extend past the box
 * (they take no space in the layout and cannot be clicked).
 */
const CANVAS = 1800;
const MARK = { left: 352, top: 345, right: 1452, bottom: 1453 };
const MARK_SIZE = Math.max(MARK.right - MARK.left, MARK.bottom - MARK.top); // 1108
const CENTER = { x: (MARK.left + MARK.right) / 2, y: (MARK.top + MARK.bottom) / 2 };

export const BRAND_LOGO_SRC = '/brand/chainsea-logo.png';

export function BrandMark({ size = 22 }: { size?: number }) {
  const scale = size / MARK_SIZE;
  const box: CSSProperties = { position: 'relative', display: 'inline-block', flexShrink: 0, width: size, height: size };
  const img: CSSProperties = {
    position: 'absolute', maxWidth: 'none', pointerEvents: 'none',
    width: CANVAS * scale, height: CANVAS * scale,
    left: size / 2 - CENTER.x * scale, top: size / 2 - CENTER.y * scale,
  };
  return (
    <span className="brand-mark" style={box} aria-hidden="true">
      {/* the original asset as is: no image optimisation pipeline, the name next to it is the label */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BRAND_LOGO_SRC} alt="" width={CANVAS} height={CANVAS} decoding="async" draggable={false} style={img} />
    </span>
  );
}
