import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_APPEARANCE_ID,
  getAppearanceDefinition,
  resolveAppearanceId,
  type AppearanceBackgroundRecipe,
  type AppearanceId,
  type AtmosphereChannel,
} from "./theme-registry.js";

const CHANNELS: Record<
  AtmosphereChannel,
  { rgbVariable: string; intensity: number }
> = {
  primary: { rgbVariable: "--theme-accent-primary-rgb", intensity: 1 },
  secondary: { rgbVariable: "--theme-accent-secondary-rgb", intensity: 1 },
  tertiary: { rgbVariable: "--theme-accent-tertiary-rgb", intensity: 0.75 },
};

const MAX_HEIGHT = 2500;
const MIN_HEIGHT = 1200;
const HERO_ZONE_HEIGHT = 800;
const ROW_SPACING = 600;
const HEIGHT_BUFFER = 480;
const MOBILE_BREAKPOINT = 768;
const DESKTOP_BASELINE_WIDTH = 1280;

interface Orb {
  channel: AtmosphereChannel;
  x: number;
  y: number;
  size: number;
  intensity: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableFraction(seed: number): number {
  const raw = Math.sin(seed * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

function appearanceSeed(appearanceId: AppearanceId): number {
  return [...appearanceId].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
}

function generateOrbs(
  appearanceId: AppearanceId,
  recipe: AppearanceBackgroundRecipe,
  viewportWidth: number,
  viewportHeight: number,
): Orb[] {
  const compact = viewportWidth < MOBILE_BREAKPOINT;
  const legacy = recipe.renderer === "legacy";
  const widthScale = clamp(viewportWidth / DESKTOP_BASELINE_WIDTH, 0.58, 1);
  const sizeScale = legacy ? 1 : Math.sqrt(widthScale);
  const intensityScale = legacy
    ? compact
      ? 0.5
      : 1
    : clamp(0.72 + widthScale * 0.28, 0.82, 1);
  const seed = appearanceSeed(appearanceId);
  const orbs: Orb[] = [];

  recipe.heroOrbs.forEach((heroOrb, index) => {
    orbs.push({
      channel: heroOrb.channel,
      x: heroOrb.xMin + stableFraction(seed + index * 7 + 1) * heroOrb.xRange,
      y: heroOrb.yMin + stableFraction(seed + index * 7 + 2) * heroOrb.yRange,
      size:
        (heroOrb.sizeMin +
          stableFraction(seed + index * 7 + 3) * heroOrb.sizeRange) *
        sizeScale,
      intensity: heroOrb.intensity * intensityScale,
    });
  });

  const rowRecipe = recipe.rowOrbs;
  const countPerRow = legacy
    ? rowRecipe.countPerRow
    : compact
      ? Math.max(1, Math.ceil(rowRecipe.countPerRow / 2))
      : rowRecipe.countPerRow;
  const targetHeight = clamp(
    viewportHeight + HEIGHT_BUFFER,
    MIN_HEIGHT,
    MAX_HEIGHT,
  );
  const rowCount =
    Math.ceil((targetHeight - HERO_ZONE_HEIGHT) / ROW_SPACING) + 1;

  for (let row = 0; row < rowCount; row += 1) {
    for (let index = 0; index < countPerRow; index += 1) {
      const position = row * countPerRow + index;
      const localSeed = seed + 100 + position * 11;
      const channelIndex = Math.floor(
        stableFraction(localSeed) * rowRecipe.channels.length,
      );
      orbs.push({
        channel: rowRecipe.channels[channelIndex] ?? "secondary",
        x: rowRecipe.xMin + stableFraction(localSeed + 1) * rowRecipe.xRange,
        y:
          HERO_ZONE_HEIGHT +
          row * ROW_SPACING +
          stableFraction(localSeed + 2) * ROW_SPACING * rowRecipe.yRangeFactor,
        size:
          (rowRecipe.sizeMin +
            stableFraction(localSeed + 3) * rowRecipe.sizeRange) *
          sizeScale,
        intensity:
          (rowRecipe.intensityMin +
            stableFraction(localSeed + 4) * rowRecipe.intensityRange) *
          intensityScale,
      });
    }
  }

  return orbs;
}

function buildOrbBackground(
  orbs: readonly Orb[],
  recipe: AppearanceBackgroundRecipe,
): string {
  return orbs
    .map((orb) => {
      const channel = CHANNELS[orb.channel];
      const opacity = Number(
        (recipe.baseOpacity * orb.intensity * channel.intensity).toFixed(5),
      );
      return `radial-gradient(${Math.round(orb.size)}px ${Math.round(orb.size)}px at ${orb.x.toFixed(2)}% ${Math.round(orb.y)}px, rgb(var(${channel.rgbVariable}) / ${opacity}), transparent)`;
    })
    .join(", ");
}

export function BackgroundAtmosphere() {
  const [appearanceId, setAppearanceId] = useState<AppearanceId>(
    DEFAULT_APPEARANCE_ID,
  );
  const [viewport, setViewport] = useState({
    width: DESKTOP_BASELINE_WIDTH,
    height: MIN_HEIGHT,
  });
  const appearance = getAppearanceDefinition(appearanceId);
  const recipe = appearance.background;

  useEffect(() => {
    const readTheme = () => {
      setAppearanceId(
        resolveAppearanceId(document.documentElement.dataset.theme),
      );
    };
    const readViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    const observer = new MutationObserver(readTheme);
    let animationFrame = 0;
    const handleResize = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(readViewport);
    };

    readTheme();
    readViewport();
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    window.addEventListener("resize", handleResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  const orbs = useMemo(
    () =>
      recipe
        ? generateOrbs(appearanceId, recipe, viewport.width, viewport.height)
        : [],
    [appearanceId, recipe, viewport.height, viewport.width],
  );
  const orbBackground = useMemo(
    () => (recipe ? buildOrbBackground(orbs, recipe) : ""),
    [orbs, recipe],
  );

  if (!recipe) return null;

  return (
    <div
      className="vorton-atmosphere"
      data-effects={appearance.effects}
      data-theme-atmosphere={appearance.id}
      aria-hidden="true"
    >
      {recipe.textures.map((texture, index) => (
        <div
          className="vorton-atmosphere-texture"
          key={`${appearance.id}-${texture.size}-${index}`}
          style={{
            backgroundImage: texture.image,
            backgroundRepeat: texture.repeat,
            backgroundSize:
              viewport.width < MOBILE_BREAKPOINT
                ? (texture.compactSize ?? texture.size)
                : texture.size,
            opacity:
              viewport.width < MOBILE_BREAKPOINT
                ? (texture.compactOpacity ?? 1)
                : 1,
          }}
        />
      ))}
      <div
        className="vorton-atmosphere-orbs"
        style={{ backgroundImage: orbBackground }}
      />
      {recipe.overlayEnabled !== false ? (
        <div
          className="vorton-atmosphere-overlay"
          style={{ backgroundImage: recipe.overlayBackground }}
        />
      ) : null}
    </div>
  );
}
