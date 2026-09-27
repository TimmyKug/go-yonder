import { useMemo } from "react";
import Svg, { Circle, Path } from "react-native-svg";

import { getGlobeFeatures } from "@/src/data/globe";
import { globeLayers, type GlobeRotation } from "@/src/domain/globe-projection";

export type GlobeColors = {
  limb: string;
  ocean: string;
  land: string;
  landEdge: string;
  visited: string;
  visitedEdge: string;
};

/**
 * The sphere itself: no state, no gestures, drawn for whatever rotation it is
 * given. The canvas is the viewport rather than the sphere, because a sphere
 * matched to a zoomed-out map is far wider than the screen and a canvas that
 * size exceeds what the GPU will allocate.
 */
export function GlobeSphere({
  colors,
  height,
  radius,
  rotation,
  visitedIds,
  width,
}: {
  colors: GlobeColors;
  height: number;
  radius: number;
  rotation: GlobeRotation;
  visitedIds: ReadonlySet<string>;
  width: number;
}) {
  const features = getGlobeFeatures();
  const centre = useMemo(() => ({ x: width / 2, y: height / 2 }), [height, width]);
  const layers = useMemo(
    () => globeLayers(features, visitedIds, rotation, radius, centre),
    [centre, features, radius, rotation, visitedIds],
  );

  return (
    <Svg height={height} width={width}>
      <Circle
        cx={centre.x}
        cy={centre.y}
        fill={colors.ocean}
        r={radius - 1}
        stroke={colors.limb}
        strokeWidth={1}
      />
      <Path d={layers.land} fill={colors.land} stroke={colors.landEdge} strokeWidth={0.5} />
      <Path d={layers.visited} fill={colors.visited} stroke={colors.visitedEdge} strokeWidth={0.8} />
    </Svg>
  );
}
