import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isHowItWorksActive,
  isNavigationRouteActive,
} from "@/components/hero/navigationState";

describe("top navigation active state", () => {
  it.each([
    ["/fit", "/fit"],
    ["/behavioural", "/behavioural"],
    ["/case", "/case"],
    ["/dashboard", "/dashboard"],
  ])("marks %s active for %s", (pathname, href) => {
    expect(isNavigationRouteActive(pathname, href)).toBe(true);
  });

  it("does not cross-highlight product destinations", () => {
    expect(isNavigationRouteActive("/behavioural", "/fit")).toBe(false);
    expect(isNavigationRouteActive("/case", "/dashboard")).toBe(false);
    expect(isNavigationRouteActive("/", "/fit")).toBe(false);
  });

  it("marks How it works active only for the open homepage carousel", () => {
    expect(isHowItWorksActive("/", "carousel")).toBe(true);
    expect(isHowItWorksActive("/", "hero")).toBe(false);
    expect(isHowItWorksActive("/behavioural", "carousel")).toBe(false);
  });

  it("wires route and non-route accessibility states with distinct focus CSS", () => {
    const navigation = readFileSync("components/hero/HeroNav.tsx", "utf8");
    const styles = readFileSync("app/globals.css", "utf8");

    expect(navigation).toContain('aria-current={active ? "page" : undefined}');
    expect(navigation).toContain("aria-pressed={howItWorksActive}");
    expect(navigation).toContain("data-active=");
    expect(styles).toContain('[aria-current="page"]');
    expect(styles).toContain('[aria-pressed="true"]');
    expect(styles).toContain(".home-navigation__links a:focus-visible");
  });
});
