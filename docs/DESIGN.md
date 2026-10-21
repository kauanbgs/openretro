# OpenRetro interface direction

## Intent

A collection of game sleeves, organized like a personal shelf. Borrow the calm spacing and warm indicator lights of home audio equipment rather than the visual language of analytics dashboards. Artwork is the expressive element; navigation and controls stay quiet.

## Tokens

| Role | Value |
| --- | --- |
| Canvas / ink | `#111521` |
| Raised surface | `#1B2131` |
| Structural rule | `#31384B` |
| Primary text | `#F4F1EB` |
| Secondary text | `#A2ABC0` |
| Control accent / amber | `#E9B27A` |

Nunito Sans carries headings, controls, descriptions and metadata, with lighter 500–600 weights for navigation and card titles. One variable Latin font is bundled locally. Type starts at 12px for secondary metadata, 14px for controls, 16px for body text; headings range from 24px to 56px. Avoid tracked uppercase labels and decorative monospace.

## Layout considered

Storefront composition:

```text
navigation | wide artwork + large title
           | console tiles + genre tiles + game tiles
```

This repeats boxed objects at every level and makes discovery controls compete with the covers. Rejected.

Collection composition, selected:

```text
navigation | search                              Add game
           | page title / useful description
           | featured artwork and game title | collection shelf
           | recently added / selected games in unframed rows
```

Discovery uses compact console tabs and two real filter controls above the cover grid, not a second grid of generic icons. Game detail uses a cover inset against a wide artwork, with title and actions aligned to the cover. All main content is left aligned. Supporting settings and emulator pages share the same page-header and form rhythm.

## Review against the brief

The previous acid-green indicator, slogan labels, tiny typography, fictitious avatar, repeated rounded tiles and arrow-suffixed text links were generic and distracted from the library. Remove them. Spend the visual emphasis on the game art and the larger title treatment. Amber is reserved for active controls and focused actions, without glow effects.

## Interaction

Hover changes contrast or shows a relevant action; cards do not float or jump. Use a short opacity transition only where state changes. Keep keyboard focus visible and respect reduced motion. Labels and copy describe the operation, including empty and unavailable states. Density, theme and animation preferences continue to work.
