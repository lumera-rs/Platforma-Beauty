import type { AnchorHTMLAttributes, ReactNode } from "react";
import { safeExternalHref } from "@/lib/safe-external-url";

interface SafeExternalLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel"> {
  href: string | null | undefined;
  children: ReactNode;
}

/**
 * Renders `children` as a real external link only when `href` parses to a
 * safe http(s) URL. A missing or unsafe value (javascript:, data:, a
 * protocol-relative URL, ...) renders nothing, so a legacy/unvalidated
 * database row can never become a clickable unsafe link.
 */
export function SafeExternalLink({ href, children, ...rest }: SafeExternalLinkProps) {
  const safeHref = safeExternalHref(href);
  if (!safeHref) return null;
  return (
    <a href={safeHref} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}
