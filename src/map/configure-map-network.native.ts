import { TransformRequestManager } from "@maplibre/maplibre-react-native";

const OPENSTREETMAP_TILE_HOST_PATTERN =
  "^https://tile\\.openstreetmap\\.org/";

TransformRequestManager.addHeader({
  id: "openstreetmap-user-agent",
  match: OPENSTREETMAP_TILE_HOST_PATTERN,
  name: "User-Agent",
  value: "Tessera/0.1 (com.timothykugler.bumpclone)",
});
