/** Widget embeds are app routes, so retain the application's mount path. */
export function ownerWidgetUrl(origin: string, basePath: string, slug: string, color: string): string {
  const base = `/${basePath.split("/").filter(Boolean).join("/")}`;
  const url = new URL(`${base === "/" ? "" : base}/widget/${encodeURIComponent(slug)}`, origin);
  if (color) url.searchParams.set("boja", color.replace(/^#/, ""));
  return url.toString();
}