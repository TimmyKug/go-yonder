# Brand decision

- Status: Accepted for beta
- Date: 2026-09-07
- Name: **Yonder**
- Tagline: **Unveil your world.**

## Naming convention

- Home-screen and in-app name: **Yonder**
- Public/store name: **Yonder: Unveil Your World**
- Repository name: **yonder-map**
- Platform identifier: `com.timothykugler.yonder`

The short device label stays uncluttered, while the public name and repository
make the app's purpose clearer while retaining the short, memorable brand.

## Intent

The name should evoke a map that permanently fills in as someone moves through
the world. It should feel visual, personal, and exploratory without implying
that location data is uploaded or shared. The product uses hexagonal H3 cells;
a “tile” is not required to be square.

## Current choice

**Yonder — Unveil your world.** is the beta identity. “Yonder” feels curious,
open, and exploratory without restricting the product to deliberate travel.
The tagline describes the central interaction: moving through the world reveals
the clear map beneath the unvisited-area veil.

Yonder starts a new platform identity at `com.timothykugler.yonder`. Operating
systems therefore install it separately from the Tessera and earlier Scratch
Map development builds; no automatic cross-app data migration is attempted.
The same dedicated production signing key may sign it, but identity is defined
by the platform identifier rather than the key alone.

## Shortlisted alternatives

- **Tessera — Tile by Tile.** The previous choice described the decorative
  mosaic implementation well, but became obsolete when the visual design moved
  toward a clear explored region with only its frontier emphasized.
- **Unveil.** Directly describes the reveal mechanic, but feels more like an
  action or tagline than a warm product name.
- **Outward / Further.** Modern and optimistic, but less memorable and specific
  to the experience.
- **Known / Known Ground.** Strong conceptual fit for turning unknown territory
  into familiar ground, but colder as an app identity.
- **Elsewhere.** Poetic and memorable, though it emphasizes distant places over
  ordinary daily movement.

- **Patina — Your world, place by place.** Beautiful and personal: movement
  gradually gives the map colour and character. It was not selected because
  “patina” does not communicate maps or tiles without explanation.
- **Covered Ground.** Descriptive double meaning for literal travelled ground
  and accumulated territory. It felt more like a phrase than a distinctive app
  identity.
- **Colortrail.** Clearly connects movement with colouring the map, but is less
  natural and refined than Tessera.
- **Mapprint / Trailprint.** Express a lasting record left by movement. Mapprint
  is direct but utilitarian; Trailprint leans toward deliberate hiking rather
  than passive everyday coverage.
- **Travel Mosaic / Map Mosaic.** Accurately describe the accumulating visual,
  but are generic and less memorable.
- **Place by Place / Painted Paths.** Friendly and visual, but better suited to
  taglines than to the product name.
- **Patchwork / Mosaic / Imprint / Wake / Inlay.** Useful metaphor directions,
  but either broad, difficult to search for, or insufficiently descriptive.

## Names set aside because of existing products

- **Scratch Map** is Bump's name for its equivalent feature, and **Skratch** is
  an established travel app.
- **Scratch Atlas** is already used by a travel-map app.
- **HexPlore** is already used by a similar hex-based travel-map app.
- **Wayprint** is already used by a private travel-history service.
- **MapMark** and **Trailmark** are already used by mapping products.
- **Uncover** overlaps heavily with MapUncover and World Uncovered.
- **Been**, **Visited**, **Places**, **Atlas**, and **Fog** combinations occupy
  crowded categories with several established travel and exploration apps.

This is a product-name collision screen, not legal clearance. Before a public
release, recheck the final name in relevant app stores, source hosts, domain
registries, and EU/US trademark databases.
