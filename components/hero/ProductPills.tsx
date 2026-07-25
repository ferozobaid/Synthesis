"use client";

import Link from "next/link";
import { HERO_MODULES, HERO_MODULE_ORDER, type ModuleKey } from "./modules";

function Arrow() {
  return <span aria-hidden="true" className="hero-product-pill__arrow">→</span>;
}

export function ProductPills({
  onSpotlight,
}: {
  onSpotlight: (key: ModuleKey | null) => void;
}) {
  return (
    <div className="hero-product-actions">
      <Link href="/onboard" className="hero-product-pill hero-product-pill--primary">
        Start preparing <Arrow />
      </Link>
      {HERO_MODULE_ORDER.map((key) => {
        const module = HERO_MODULES[key];
        return (
          <Link
            key={key}
            href={module.href}
            className="hero-product-pill"
            onMouseEnter={() => onSpotlight(key)}
            onMouseLeave={() => onSpotlight(null)}
            onFocus={() => onSpotlight(key)}
            onBlur={() => onSpotlight(null)}
          >
            <span>{module.index}</span>
            <span className="hero-product-pill__desktop-label">{module.pill}</span>
            <span className="hero-product-pill__mobile-label">{module.nav}</span>
            <Arrow />
          </Link>
        );
      })}
    </div>
  );
}
