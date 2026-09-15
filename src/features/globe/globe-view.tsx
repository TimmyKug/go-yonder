import { useMemo, useState } from "react";
import { PanResponder, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { getGlobeFeatures } from "@/src/data/globe";
import {
  globeOutlines,
  rotateToward,
  type GlobeFeature,
  type GlobeRotation,
} from "@/src/domain/globe-projection";

const DEGREES_PER_PIXEL = 0.35;
const DEFAULT_ROTATION: GlobeRotation = { latitude: 20, longitude: 10 };

export type GlobeColors = {
  limb: string;
  ocean: string;
  land: string;
  landEdge: string;
  visited: string;
  visitedEdge: string;
};

/** Face the first visited country, so the globe opens on something the user recognises. */
function initialRotation(
  features: readonly GlobeFeature[],
  visitedIds: ReadonlySet<string>,
): GlobeRotation {
  const visited = features.find(({ id }) => visitedIds.has(id));
  const ring = visited?.rings[0];
  if (!ring || ring.length === 0) return DEFAULT_ROTATION;
  let longitude = 0;
  let latitude = 0;
  for (let index = 0; index < ring.length; index += 2) {
    longitude += ring[index]!;
    latitude += ring[index + 1]!;
  }
  const points = ring.length / 2;
  return { latitude: latitude / points, longitude: longitude / points };
}

export function GlobeView({
  colors,
  size,
  visitedIds,
}: {
  colors: GlobeColors;
  size: number;
  visitedIds: ReadonlySet<string>;
}) {
  const features = getGlobeFeatures();
  const radius = size / 2;
  const [rotation, setRotation] = useState(() => initialRotation(features, visitedIds));
  // Cumulative gesture offsets, kept outside render so each move applies only its own step.
  const [gesture] = useState(() => ({ dx: 0, dy: 0 }));
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        gesture.dx = 0;
        gesture.dy = 0;
      },
      onPanResponderMove: (_event, { dx, dy }) => {
        const stepX = dx - gesture.dx;
        const stepY = dy - gesture.dy;
        gesture.dx = dx;
        gesture.dy = dy;
        setRotation((current) =>
          rotateToward(current, -stepX * DEGREES_PER_PIXEL, stepY * DEGREES_PER_PIXEL),
        );
      },
    }),
  );
  const outlines = useMemo(
    () => globeOutlines(features, rotation, radius),
    [features, rotation, radius],
  );

  return (
    <View
      accessibilityLabel={`Globe showing ${visitedIds.size} visited countries. Drag to rotate.`}
      accessibilityRole="image"
      testID="globe-view"
      {...panResponder.panHandlers}
    >
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
    </View>
  );
}
