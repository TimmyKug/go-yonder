import { TransformRequestManager } from "@maplibre/maplibre-react-native";

const OPENSTREETMAP_TILE_HOST_PATTERN =
  "^https://tile\\.openstreetmap\\.org/";

TransformRequestManager.addHeader({
  id: "openstreetmap-user-agent",
  match: OPENSTREETMAP_TILE_HOST_PATTERN,
  name: "User-Agent",
  value: "ScratchMap/1.0 (com.timothykugler.bumpclone)",
});
