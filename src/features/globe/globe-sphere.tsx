import { useMemo } from "react";
import Svg, { Circle, Path } from "react-native-svg";

import { getGlobeFeatures } from "@/src/data/globe";
import { globeOutlines, type GlobeRotation } from "@/src/domain/globe-projection";

export type GlobeColors = {
  limb: string;
  ocean: string;
  land: string;
  landEdge: string;
  visited: string;
  visitedEdge: string;
};

/** The sphere itself: no state, no gestures, drawn for whatever rotation it is given. */
export function GlobeSphere({
  colors,
  radius,
  rotation,
  visitedIds,
}: {
  colors: GlobeColors;
  radius: number;
  rotation: GlobeRotation;
  visitedIds: ReadonlySet<string>;
}) {
  const features = getGlobeFeatures();
  const outlines = useMemo(
    () => globeOutlines(features, rotation, radius),
    [features, rotation, radius],
  );
  const size = radius * 2;

  return (
    <Svg height={size} width={size}>
      <Circle cx={radius} cy={radius} fill={colors.ocean} r={radius - 1} stroke={colors.limb} strokeWidth={1} />
      {outlines.map(({ id, path }) => {
        const visited = visitedIds.has(id);
        return (
          <Path
            d={path}
            fill={visited ? colors.visited : colors.land}
            key={id}
            stroke={visited ? colors.visitedEdge : colors.landEdge}
            strokeWidth={visited ? 0.8 : 0.5}
          />
        );
      })}
    </Svg>
  );
}
