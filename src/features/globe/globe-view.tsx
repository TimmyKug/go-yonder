import { useEffect, useState } from "react";
import { PanResponder, View } from "react-native";

import { GlobeSphere, type GlobeColors } from "./globe-sphere";

import { getGlobeFeatures } from "@/src/data/globe";
import {
  rotateToward,
  type GlobeFeature,
  type GlobeRotation,
} from "@/src/domain/globe-projection";

export type { GlobeColors };

const DEGREES_PER_PIXEL = 0.35;
const DEFAULT_ROTATION: GlobeRotation = { latitude: 20, longitude: 10 };

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
  const [rotation, setRotation] = useState(() => initialRotation(features, visitedIds));
  // Cumulative gesture offsets, kept outside render so each move applies only its own step.
  // Steps accumulate until the next frame, so touch events faster than the display
  // refresh cost one redraw per frame rather than one each.
  const [gesture] = useState(() => ({ dx: 0, dy: 0, pendingX: 0, pendingY: 0, frame: 0 }));
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the drag once it starts, so the list and the sheet around the globe
      // cannot take it over mid-spin.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        gesture.dx = 0;
        gesture.dy = 0;
      },
      onPanResponderMove: (_event, { dx, dy }) => {
        gesture.pendingX += dx - gesture.dx;
        gesture.pendingY += dy - gesture.dy;
        gesture.dx = dx;
        gesture.dy = dy;
        if (gesture.frame !== 0) return;
        gesture.frame = requestAnimationFrame(() => {
          const stepX = gesture.pendingX;
          const stepY = gesture.pendingY;
          gesture.pendingX = 0;
          gesture.pendingY = 0;
          gesture.frame = 0;
          setRotation((current) =>
            rotateToward(current, -stepX * DEGREES_PER_PIXEL, stepY * DEGREES_PER_PIXEL),
          );
        });
      },
    }),
  );
  useEffect(() => () => cancelAnimationFrame(gesture.frame), [gesture]);
  return (
    <View
      accessibilityLabel={`Globe showing ${visitedIds.size} visited countries. Drag to rotate.`}
      accessibilityRole="image"
      testID="globe-view"
      {...panResponder.panHandlers}
    >
      <GlobeSphere
        colors={colors}
        height={size}
        radius={size / 2}
        rotation={rotation}
        visitedIds={visitedIds}
        width={size}
      />
    </View>
  );
}
