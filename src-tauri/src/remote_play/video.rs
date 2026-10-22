//! Capture once, crop before JPEG encoding, and share each requested view.
//! Slow phones keep only the latest two frames; unused views cost no encoding.
use axum::body::Bytes;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Layout {
    #[default]
    Full,
    SideBySide,
    Stacked,
    Grid,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct View {
    pub layout: Layout,
    pub region: u8,
}

impl View {
    pub fn new(layout: Layout, region: u8) -> Self {
        let count = match layout {
            Layout::Full => 0,
            Layout::SideBySide | Layout::Stacked => 2,
            Layout::Grid => 4,
        };
        if region == 0 || region > count {
            Self::default()
        } else {
            Self { layout, region }
        }
    }

    /// Half-open bounds partition odd dimensions without dropping a row/column.
    fn bounds(self, width: u32, height: u32) -> (u32, u32, u32, u32) {
        let (columns, rows) = match self.layout {
            Layout::Full => return (0, 0, width, height),
            Layout::SideBySide => (2, 1),
            Layout::Stacked => (1, 2),
            Layout::Grid => (2, 2),
        };
        // Tiny frames have no meaningful split.
        if width < columns || height < rows {
            return (0, 0, width, height);
        }
        let index = u32::from(self.region - 1);
        let (column, row) = (index % columns, index / columns);
        (
            column * width / columns,
            row * height / rows,
            (column + 1) * width / columns,
            (row + 1) * height / rows,
        )
    }
}

#[derive(Clone)]
pub struct Video {
    channels: std::sync::Arc<Vec<(View, broadcast::Sender<Bytes>)>>,
}

impl Default for Video {
    fn default() -> Self {
        let mut views = vec![View::default()];
        for layout in [Layout::SideBySide, Layout::Stacked, Layout::Grid] {
            for region in 1..=if layout == Layout::Grid { 4 } else { 2 } {
                views.push(View::new(layout, region));
            }
        }
        Self {
            channels: std::sync::Arc::new(
                views
                    .into_iter()
                    .map(|view| (view, broadcast::channel(2).0))
                    .collect(),
            ),
        }
    }
}

impl Video {
    pub fn subscribe(&self, view: View) -> broadcast::Receiver<Bytes> {
        self.channels
            .iter()
            .find(|(v, _)| *v == view)
            .unwrap_or(&self.channels[0])
            .1
            .subscribe()
    }

    pub fn receiver_count(&self) -> usize {
        self.channels
            .iter()
            .map(|(_, sender)| sender.receiver_count())
            .sum()
    }

    pub fn publish(
        &self,
        rgb: &[u8],
        width: u32,
        height: u32,
        quality: u8,
    ) -> image::ImageResult<()> {
        for (view, sender) in self.channels.iter() {
            if sender.receiver_count() == 0 {
                continue;
            }
            let (x0, y0, x1, y1) = view.bounds(width, height);
            let (w, h) = (x1 - x0, y1 - y0);
            let mut cropped = Vec::new();
            let pixels = if *view == View::default() {
                rgb
            } else {
                cropped.reserve((w * h * 3) as usize);
                for y in y0..y1 {
                    cropped.extend_from_slice(
                        &rgb[((y * width + x0) * 3) as usize..((y * width + x1) * 3) as usize],
                    );
                }
                &cropped
            };
            let mut jpeg = vec![1]; // Existing video wire format: tag + JPEG.
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, quality).encode(
                pixels,
                w,
                h,
                image::ExtendedColorType::Rgb8,
            )?;
            let _ = sender.send(Bytes::from(jpeg));
        }
        Ok(())
    }
}

pub fn load_layout(conn: &rusqlite::Connection, game: &str) -> Layout {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [format!("phone-layout:{game}")],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|value| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

pub fn save_layout(
    conn: &rusqlite::Connection,
    game: &str,
    layout: Layout,
) -> crate::database::Result<()> {
    let value = serde_json::to_string(&layout).map_err(crate::database::error)?;
    conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![format!("phone-layout:{game}"), value]).map_err(crate::database::error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layouts_cover_odd_frames_and_invalid_seats_fall_back_to_full() {
        assert_eq!(
            View::new(Layout::SideBySide, 2).bounds(641, 481),
            (320, 0, 641, 481)
        );
        assert_eq!(
            View::new(Layout::Stacked, 2).bounds(641, 481),
            (0, 240, 641, 481)
        );
        assert_eq!(
            View::new(Layout::Grid, 4).bounds(641, 481),
            (320, 240, 641, 481)
        );
        for region in [0, 3, 255] {
            assert_eq!(View::new(Layout::Stacked, region), View::default());
        }
    }

    #[test]
    fn phones_receive_their_own_cropped_pixels_and_full_view_stays_available() {
        let video = Video::default();
        let mut j1 = video.subscribe(View::new(Layout::Grid, 1));
        let mut same_view = video.subscribe(View::new(Layout::Grid, 1));
        let mut j4 = video.subscribe(View::new(Layout::Grid, 4));
        let mut full = video.subscribe(View::default());
        let mut rgb = Vec::new();
        for y in 0..64 {
            for x in 0..64 {
                rgb.extend_from_slice(if x < 32 && y < 32 {
                    &[250, 0, 0]
                } else {
                    &[0, 0, 250]
                });
            }
        }
        video.publish(&rgb, 64, 64, 95).unwrap();
        let decode = |bytes: Bytes| {
            assert_eq!(bytes[0], 1);
            image::load_from_memory(&bytes[1..]).unwrap().to_rgb8()
        };
        let first_packet = j1.try_recv().unwrap();
        let shared_packet = same_view.try_recv().unwrap();
        assert_eq!(first_packet.as_ptr(), shared_packet.as_ptr());
        let first = decode(first_packet);
        let fourth = decode(j4.try_recv().unwrap());
        assert_eq!(first.dimensions(), (32, 32));
        assert!(first.get_pixel(16, 16)[0] > 240);
        assert!(fourth.get_pixel(16, 16)[2] > 240);
        assert_eq!(decode(full.try_recv().unwrap()).dimensions(), (64, 64));
        assert_eq!(video.receiver_count(), 4);
        drop(j1);
        drop(j4);
        drop(full);
        drop(same_view);
        assert_eq!(video.receiver_count(), 0);
    }

    #[test]
    fn layout_is_saved_per_game_and_survives_a_new_database_connection() {
        let path =
            std::env::temp_dir().join(format!("openretro-layout-{}.sqlite", uuid::Uuid::new_v4()));
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute(
            "CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
            [],
        )
        .unwrap();
        assert_eq!(load_layout(&db, "one"), Layout::Full);
        save_layout(&db, "one", Layout::Grid).unwrap();
        save_layout(&db, "two", Layout::Stacked).unwrap();
        drop(db);
        let db = rusqlite::Connection::open(&path).unwrap();
        assert_eq!(load_layout(&db, "one"), Layout::Grid);
        assert_eq!(load_layout(&db, "two"), Layout::Stacked);
        save_layout(&db, "one", Layout::Full).unwrap();
        assert_eq!(load_layout(&db, "one"), Layout::Full);
        assert_eq!(load_layout(&db, "two"), Layout::Stacked);
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
}
