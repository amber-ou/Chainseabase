import { Logo } from '@/components/icons';

/**
 * The brand mark, in one place for the login, invitation, admin sidebar and portal headers.
 * Phase 5 (docs/change-requests/sidebar-position.md, Logo 更新): the supplied chainsea logo PNG
 * replaces this once the original file is in the repository; until then the existing icon stays,
 * rather than a redrawn or substitute image.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return <Logo size={size} aria-hidden="true" focusable="false" />;
}
