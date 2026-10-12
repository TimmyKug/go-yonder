import {
  Canvas,
  Circle,
  FilterMode,
  ImageShader,
  MipmapMode,
  PaintStyle,
  Shader,
  Skia,
  type SkImage,
  type SkRuntimeEffect,
} from "@shopify/react-native-skia";
import { useMemo } from "react";
import { PixelRatio } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";

import { getGlobeFeatures } from "@/src/data/globe";
import {
  globeMapPaths,
  globeTextureSize,
  type GlobeFeature,
  type GlobeRotation,
} from "@/src/domain/globe-projection";

export type GlobeColors = {
  limb: string;
  ocean: string;
  land: string;
  landEdge: string;
  visited: string;
  visitedEdge: string;
};

/**
 * For each pixel of the disc, the inverse orthographic projection gives a
 * latitude and longitude, which pick a pixel of the world texture. It matches
 * `globePointToCoordinate`. Longitude wraps across the antimeridian.
 */
const SPHERE_SHADER_SOURCE = `
uniform shader world;
uniform float2 centre;
uniform float radius;
uniform float2 worldSize;
uniform float sinLat;
uniform float cosLat;
uniform float longitude;

const float PI = 3.14159265;

half4 main(float2 point) {
  float across = (point.x - centre.x) / radius;
  float up = (centre.y - point.y) / radius;
  float depth = sqrt(max(1.0 - across * across - up * up, 0.0));
  float along = cosLat * depth - sinLat * up;
  float z = clamp(sinLat * depth + cosLat * up, -1.0, 1.0);
  float lambda = longitude + atan(across, along);
  float u = fract(lambda / (2.0 * PI) + 0.5) * worldSize.x;
  float v = (0.5 - asin(z) / PI) * worldSize.y;
  return world.eval(float2(u, v));
}
`;

function compileSphereShader(): SkRuntimeEffect {
  const effect = Skia.RuntimeEffect.Make(SPHERE_SHADER_SOURCE);
  if (!effect) throw new Error("The globe shader did not compile.");
  return effect;
}

const SPHERE_SHADER = compileSphereShader();

const DEGREES = Math.PI / 180;
// Edge widths at the centre of the sphere, in points, as the globe drew them before.
const LAND_EDGE_WIDTH = 0.5;
const VISITED_EDGE_WIDTH = 0.8;

/**
 * Paints ocean, land and visited land with their edges onto an equirectangular
 * image once. Only the theme or the visited countries change it.
 */
function paintWorldTexture(
  features: readonly GlobeFeature[],
  visitedIds: ReadonlySet<string>,
  colors: GlobeColors,
  radius: number,
): SkImage | null {
  const { width, height } = globeTextureSize(radius * PixelRatio.get());
  const surface = Skia.Surface.Make(width, height);
  if (!surface) return null;
  // Texture pixels per point at the centre of the sphere.
  const scale = width / (2 * Math.PI * radius);
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color(colors.ocean));
  const paths = globeMapPaths(features, visitedIds, width, height);
  const layers = [
    { path: paths.land, fill: colors.land, edge: colors.landEdge, edgeWidth: LAND_EDGE_WIDTH },
    { path: paths.visited, fill: colors.visited, edge: colors.visitedEdge, edgeWidth: VISITED_EDGE_WIDTH },
  ];
  for (const { path, fill, edge, edgeWidth } of layers) {
    const shape = path ? Skia.Path.MakeFromSVGString(path) : null;
    if (!shape) continue;
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(fill));
    canvas.drawPath(shape, paint);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(edgeWidth * scale);
    paint.setColor(Skia.Color(edge));
    canvas.drawPath(shape, paint);
  }
  surface.flush();
  return surface.makeImageSnapshot();
}

const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.None };

/** The sphere itself: no gestures, drawn for whatever rotation the shared value holds. */
export function GlobeSphere({
  colors,
  rotation,
  size,
  visitedIds,
}: {
  colors: GlobeColors;
  rotation: SharedValue<GlobeRotation>;
  size: number;
  visitedIds: ReadonlySet<string>;
}) {
  const radius = size / 2;
  const features = getGlobeFeatures();
  const world = useMemo(
    () => paintWorldTexture(features, visitedIds, colors, radius),
    [colors, features, radius, visitedIds],
  );
  const worldWidth = world?.width() ?? 1;
  const worldHeight = world?.height() ?? 1;
  const uniforms = useDerivedValue(() => {
    const latitude = rotation.value.latitude * DEGREES;
    return {
      centre: [radius, radius],
      radius,
      worldSize: [worldWidth, worldHeight],
      sinLat: Math.sin(latitude),
      cosLat: Math.cos(latitude),
      longitude: rotation.value.longitude * DEGREES,
    };
  }, [radius, worldHeight, worldWidth]);

  return (
    <Canvas style={{ height: size, width: size }}>
      <Circle cx={radius} cy={radius} r={radius - 1} color={colors.ocean}>
        {world ? (
          <Shader source={SPHERE_SHADER} uniforms={uniforms}>
            <ImageShader fit="none" image={world} sampling={SAMPLING} tx="repeat" ty="clamp" />
          </Shader>
        ) : null}
      </Circle>
      <Circle cx={radius} cy={radius} r={radius - 1} color={colors.limb} style="stroke" strokeWidth={1} />
    </Canvas>
  );
}
