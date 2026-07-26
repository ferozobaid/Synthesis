import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("responsive release navigation", () => {
  it("uses the compact accessible menu throughout tablet widths", () => {
    const navigation = readFileSync("components/hero/HeroNav.tsx", "utf8");
    const styles = readFileSync("app/globals.css", "utf8");

    expect(styles).toContain("@media (max-width: 1199px)");
    expect(styles).toContain(
      ".home-navigation__actions .home-navigation__enter",
    );
    expect(styles).toContain(".home-navigation__menu-toggle,");
    expect(styles).toContain("white-space: nowrap;");

    expect(navigation).toContain('aria-controls="home-mobile-menu"');
    expect(navigation).toContain("aria-expanded={menuOpen}");
    expect(navigation).toContain('href="/dashboard"');
    expect(navigation).toContain('href="/onboard"');
    expect(navigation).toContain("tabIndex={menuOpen ? 0 : -1}");
  });

  it("puts the phone readiness preview before copy without changing desktop focus order", () => {
    const slide = readFileSync(
      "components/home/slides/ReadinessOverviewSlide.tsx",
      "utf8",
    );
    const styles = readFileSync("app/globals.css", "utf8");
    const mobileStage = slide.indexOf("home-readiness-stage--mobile");
    const copy = slide.indexOf('className="home-slide__copy"');
    const desktopStage = slide.indexOf("home-readiness-stage--desktop");

    expect(mobileStage).toBeGreaterThan(-1);
    expect(mobileStage).toBeLessThan(copy);
    expect(copy).toBeLessThan(desktopStage);
    expect(styles).toContain(".home-readiness-stage--mobile");
    expect(styles).toContain(".home-readiness-stage--desktop");
    expect(styles).toContain("padding-bottom: 178px;");
  });

  it("uses a centered, reduced-motion-safe triple-arrow return control", () => {
    const carousel = readFileSync(
      "components/home/SynthesisCarousel.tsx",
      "utf8",
    );
    const styles = readFileSync("app/globals.css", "utf8");

    expect(carousel).toContain("home-carousel__back-cue");
    expect(carousel).toContain("home-carousel__back-arrows");
    expect(carousel).toContain("home-carousel__back-line");
    expect(carousel).toContain("home-carousel__back-label");
    expect(carousel.split("<i />")).toHaveLength(4);
    expect(carousel).toContain("onClick={onReturnToHero}");
    expect(carousel).toContain("Back to landing");
    expect(carousel).toContain("activeSlide === 0");
    expect(styles).toContain("@keyframes home-back-arrow-rise");
    expect(styles).toContain("@keyframes home-back-line-glow");
    expect(styles).toContain(".home-carousel__back-arrows i");
    expect(styles).toContain(
      "bottom: clamp(16px, 2.5vh, 24px);",
    );
    expect(styles).toContain("left: 50%;");
    expect(styles).toContain("transform: translateX(-50%);");
    expect(styles).toContain("padding-bottom: 178px;");
    expect(styles).toContain("animation: none;");
  });

  it("centers a full-size Explore target on compact-height phones", () => {
    const hero = readFileSync(
      "components/hero/SynthesisHero.tsx",
      "utf8",
    );
    const styles = readFileSync("app/globals.css", "utf8");

    expect(hero).toContain('aria-label="Explore Synthesis"');
    expect(styles).toContain(
      "@media (max-width: 760px) and (max-height: 760px)",
    );
    expect(styles).toContain("right: 50%;");
    expect(styles).toContain("width: 132px;");
    expect(styles).toContain("height: 44px;");
    expect(styles).toContain("transform: translateX(50%);");
  });

  it("routes preparation CTAs through canonical role setup", () => {
    for (const path of [
      "components/hero/ProductPills.tsx",
      "components/home/slides/ReadinessOverviewSlide.tsx",
      "components/home/slides/ModulesOverviewSlide.tsx",
    ]) {
      expect(readFileSync(path, "utf8")).toContain('href="/onboard"');
    }
  });
});
