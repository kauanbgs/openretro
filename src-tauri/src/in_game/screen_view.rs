//! A local display preference. It never changes netplay state or controller ports.
use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Layout {
    #[default]
    Full,
    SideBySide,
    Stacked,
    Grid,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenView {
    pub layout: Layout,
    pub region: u8,
    pub full: bool,
}

impl Default for ScreenView {
    fn default() -> Self {
        Self {
            layout: Layout::Full,
            region: 1,
            full: true,
        }
    }
}

impl ScreenView {
    pub fn change(&mut self, action: &str) -> bool {
        match action {
            "view_layout" => {
                self.layout = match self.layout {
                    Layout::Full => Layout::SideBySide,
                    Layout::SideBySide => Layout::Stacked,
                    Layout::Stacked => Layout::Grid,
                    Layout::Grid => Layout::Full,
                };
                self.region = self.region.min(self.count());
                self.full = self.layout == Layout::Full;
            }
            "view_region" => {
                self.region = self.region % self.count() + 1;
            }
            "view_toggle" => {
                if self.layout != Layout::Full {
                    self.full = !self.full;
                }
            }
            _ => return false,
        }
        true
    }

    fn count(self) -> u8 {
        match self.layout {
            Layout::Full => 1,
            Layout::Grid => 4,
            _ => 2,
        }
    }

    /// The complete renderer keeps the main window's aspect ratio. Its selected
    /// rectangle is centered and clipped with a window region, so adjacent
    /// players never leak into the letterbox area. No frame readback is needed.
    pub fn placement(self, width: i32, height: i32) -> Placement {
        let width = width.clamp(1, 16384);
        let height = height.clamp(1, 16384);
        let (columns, rows) = if self.full {
            (1, 1)
        } else {
            match self.layout {
                Layout::Full => (1, 1),
                Layout::SideBySide => (2, 1),
                Layout::Stacked => (1, 2),
                Layout::Grid => (2, 2),
            }
        };
        let scale = columns.min(rows);
        let full_width = width * scale;
        let full_height = height * scale;
        let index = i32::from(self.region.saturating_sub(1)).min(columns * rows - 1);
        let left = index % columns * full_width / columns;
        let top = index / columns * full_height / rows;
        let right = (index % columns + 1) * full_width / columns;
        let bottom = (index / columns + 1) * full_height / rows;
        Placement {
            x: (width - (right - left)) / 2 - left,
            y: (height - (bottom - top)) / 2 - top,
            width: full_width,
            height: full_height,
            clip: (left, top, right, bottom),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub clip: (i32, i32, i32, i32),
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quadrants_are_enlarged_and_offset_to_show_only_the_selected_player() {
        let view = ScreenView {
            layout: Layout::Grid,
            region: 4,
            full: false,
        };
        assert_eq!(
            view.placement(1920, 1080),
            Placement {
                x: -1920,
                y: -1080,
                width: 3840,
                height: 2160,
                clip: (1920, 1080, 3840, 2160),
            }
        );
    }
    #[test]
    fn halves_are_centered_without_stretching_or_showing_adjacent_regions() {
        let side = ScreenView {
            layout: Layout::SideBySide,
            region: 2,
            full: false,
        };
        assert_eq!(
            side.placement(1920, 1080),
            Placement {
                x: -480,
                y: 0,
                width: 1920,
                height: 1080,
                clip: (960, 0, 1920, 1080),
            }
        );
        let stacked = ScreenView {
            layout: Layout::Stacked,
            region: 2,
            full: false,
        };
        assert_eq!(stacked.placement(1920, 1080).y, -270);
    }
    #[test]
    fn full_screen_restores_original_geometry_and_remembers_the_choice() {
        let mut view = ScreenView {
            layout: Layout::Grid,
            region: 4,
            full: false,
        };
        view.change("view_toggle");
        assert_eq!(view.placement(1920, 1080).clip, (0, 0, 1920, 1080));
        view.change("view_toggle");
        assert_eq!(view.region, 4);
        assert_eq!(view.placement(1920, 1080).x, -1920);
        view.change("view_layout");
        assert_eq!(view.region, 1);
        assert!(view.full);
    }
    #[test]
    fn every_region_stays_inside_the_renderer_even_at_odd_sizes() {
        for layout in [
            Layout::Full,
            Layout::SideBySide,
            Layout::Stacked,
            Layout::Grid,
        ] {
            for region in 1..=4 {
                let p = ScreenView {
                    layout,
                    region,
                    full: false,
                }
                .placement(1919, 1079);
                let (l, t, r, b) = p.clip;
                assert!(l >= 0 && t >= 0 && r <= p.width && b <= p.height);
                assert!(p.x + l >= 0 && p.y + t >= 0);
                assert!(p.x + r <= 1919 && p.y + b <= 1079);
            }
        }
    }
}
