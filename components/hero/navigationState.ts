export function isNavigationRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isHowItWorksActive(
  pathname: string,
  mode: "hero" | "carousel",
): boolean {
  return pathname === "/" && mode === "carousel";
}
