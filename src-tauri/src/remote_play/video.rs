//! Capture once, crop before JPEG encoding, and share each requested view.
//! Slow phones keep only the latest two frames; unused views cost no encoding.
//! Party and phone WebRTC share one uncompressed loopback packet instead: the
//! PC's webview crops and encodes it as H.264 or VP9.
use axum::body::Bytes;
use image::ImageEncoder;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tokio::sync::broadcast;

const PARTY_INTERVAL_US: u64 = 16_666;
const DEFAULT_RTC_INTERVAL_US: u64 = 33_333;
/// Loopback packet tags: little-endian width/height, then 4 bytes a pixel.
pub const RGBX: u8 = 4;
pub const BGRX: u8 = 5;
const PACKET_HEADER: usize = 9;

/// An empty raw packet; the producer appends `width`×`height` pixels in
/// `tag`'s order, converting each frame once straight into what is sent.
pub fn raw_packet(tag: u8, width: u32, height: u32) -> Vec<u8> {
    let mut packet = Vec::with_capacity(PACKET_HEADER + width as usize * height as usize * 4);
    packet.push(tag);
    packet.extend_from_slice(&width.to_le_bytes());
    packet.extend_from_slice(&height.to_le_bytes());
    packet
}

/// Large frames cross loopback raw; small pixel-art frames stay compact PNGs.
fn raw_size(width: u32, height: u32) -> bool {
    u64::from(width) * u64::from(height) > 640 * 480
}

/// Nearest-neighbour fit for phone JPEGs beside an encoder (see `publish`).
fn phone_size(width: u32, height: u32) -> (u32, u32) {
    let scale = (640.0 / width as f64).min(480.0 / height as f64);
    (
        (width as f64 * scale).round() as u32,
        (height as f64 * scale).round() as u32,
    )
}

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
    party: broadcast::Sender<Bytes>,
    /// The phone WebRTC encoder in the PC's webview.
    rtc: broadcast::Sender<Bytes>,
    /// Its frame interval in microseconds, from the phone smoothness setting.
    rtc_interval: std::sync::Arc<std::sync::atomic::AtomicU64>,
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
            party: broadcast::channel(2).0,
            rtc: broadcast::channel(2).0,
            rtc_interval: std::sync::Arc::new(DEFAULT_RTC_INTERVAL_US.into()),
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
    pub fn subscribe_party(&self) -> broadcast::Receiver<Bytes> {
        self.party.subscribe()
    }

    pub fn party_active(&self) -> bool {
        self.party.receiver_count() > 0
    }

    pub fn subscribe_rtc(&self) -> broadcast::Receiver<Bytes> {
        self.rtc.subscribe()
    }

    /// A WebRTC encoder takes frames up to 720p instead of phone JPEG sizes.
    pub fn encoder_active(&self) -> bool {
        self.party_active() || self.rtc.receiver_count() > 0
    }

    /// Phone play's 30 or 60 fps; Party can follow a 60 fps game.
    pub fn set_rtc_frame_rate(&self, fps: u64) {
        self.rtc_interval
            .store(1_000_000 / fps.clamp(30, 60), Ordering::Relaxed);
    }

    /// The shortest gap between frames an active encoder takes. It sits a
    /// fifth below the interval: a 60 fps source paced at exactly 33.3 ms
    /// drops a frame that arrives a little early and leaves a doubled gap.
    pub fn encoder_gap(&self) -> Option<std::time::Duration> {
        let interval = if self.party_active() {
            PARTY_INTERVAL_US
        } else if self.rtc.receiver_count() > 0 {
            self.rtc_interval.load(Ordering::Relaxed)
        } else {
            return None;
        };
        Some(std::time::Duration::from_micros(interval * 4 / 5))
    }

    pub fn subscribe(&self, view: View) -> broadcast::Receiver<Bytes> {
        self.channels
            .iter()
            .find(|(v, _)| *v == view)
            .unwrap_or(&self.channels[0])
            .1
            .subscribe()
    }

    pub fn receiver_count(&self) -> usize {
        self.party.receiver_count()
            + self.rtc.receiver_count()
            + self
                .channels
                .iter()
                .map(|(_, sender)| sender.receiver_count())
                .sum::<usize>()
    }

    pub fn publish(
        &self,
        rgb: &[u8],
        width: u32,
        height: u32,
        quality: u8,
    ) -> image::ImageResult<()> {
        // Large game frames cross loopback as RGBA: avoid a PNG encode/decode
        // before WebRTC compresses them. Small pixel-art frames stay compact.
        // Neither local format travels through the public TURN service.
        if self.encoder_active() {
            let packet = party_packet(rgb, width, height)?;
            if self.party_active() {
                let _ = self.party.send(packet.clone());
            }
            if self.rtc.receiver_count() > 0 {
                let _ = self.rtc.send(packet);
            }
        }
        // Keep phone JPEG bandwidth at its previous size beside an encoder.
        let phone = if self
            .channels
            .iter()
            .any(|(_, sender)| sender.receiver_count() > 0)
            && self.encoder_active()
            && quality <= 75
            && (width > 640 || height > 480)
        {
            let source = image::RgbImage::from_raw(width, height, rgb.to_vec()).unwrap();
            let (w, h) = phone_size(width, height);
            Some(image::imageops::resize(
                &source,
                w,
                h,
                image::imageops::FilterType::Nearest,
            ))
        } else {
            None
        };
        let (rgb, width, height) = phone
            .as_ref()
            .map(|frame| (frame.as_raw().as_slice(), frame.width(), frame.height()))
            .unwrap_or((rgb, width, height));
        self.jpegs(rgb, width, height, quality)
    }

    /// Whether a producer should write this frame size straight into a raw
    /// packet (`raw_packet`) and hand it to `publish_packet`.
    pub fn takes_raw(&self, width: u32, height: u32) -> bool {
        self.encoder_active() && raw_size(width, height)
    }

    /// Sends a finished raw packet as is. Phones still watching JPEG views
    /// get RGB sampled from it, at the size `publish` gives them.
    pub fn publish_packet(&self, packet: Vec<u8>, quality: u8) -> image::ImageResult<()> {
        let packet = Bytes::from(packet);
        if self.party_active() {
            let _ = self.party.send(packet.clone());
        }
        if self.rtc.receiver_count() > 0 {
            let _ = self.rtc.send(packet.clone());
        }
        if self
            .channels
            .iter()
            .all(|(_, sender)| sender.receiver_count() == 0)
        {
            return Ok(());
        }
        let width = u32::from_le_bytes(packet[1..5].try_into().unwrap());
        let height = u32::from_le_bytes(packet[5..9].try_into().unwrap());
        let (w, h) = if quality <= 75 && (width > 640 || height > 480) {
            phone_size(width, height)
        } else {
            (width, height)
        };
        let (w, h) = (w.max(1), h.max(1));
        let pixels = &packet[PACKET_HEADER..];
        let bgr = packet[0] == BGRX;
        let mut rgb = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h {
            let row = (u64::from(y) * u64::from(height) / u64::from(h)) as usize * width as usize;
            for x in 0..w {
                let at = (row + (u64::from(x) * u64::from(width) / u64::from(w)) as usize) * 4;
                let px = &pixels[at..at + 3];
                rgb.extend_from_slice(&if bgr {
                    [px[2], px[1], px[0]]
                } else {
                    [px[0], px[1], px[2]]
                });
            }
        }
        self.jpegs(&rgb, w, h, quality)
    }

    fn jpegs(&self, rgb: &[u8], width: u32, height: u32, quality: u8) -> image::ImageResult<()> {
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

fn party_packet(rgb: &[u8], width: u32, height: u32) -> image::ImageResult<Bytes> {
    // Producers write large frames as raw packets themselves (`takes_raw`);
    // this covers a frame converted just before an encoder joined.
    if raw_size(width, height) {
        let mut packet = raw_packet(RGBX, width, height);
        for source in rgb.chunks_exact(3) {
            packet.extend_from_slice(&[source[0], source[1], source[2], 255]);
        }
        return Ok(Bytes::from(packet));
    }
    let mut png = vec![3];
    image::codecs::png::PngEncoder::new_with_quality(
        &mut png,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::NoFilter,
    )
    .write_image(rgb, width, height, image::ExtendedColorType::Rgb8)?;
    Ok(Bytes::from(png))
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
    fn party_bridge_preserves_exact_pixels_and_full_resolution() {
        let video = Video::default();
        let mut party = video.subscribe_party();
        let mut phone = video.subscribe(View::default());
        let rgb: Vec<u8> = (0..1280 * 720 * 3).map(|i| (i % 251) as u8).collect();
        video.publish(&rgb, 1280, 720, 75).unwrap();
        let packet = party.try_recv().unwrap();
        assert_eq!(packet[0], 4);
        assert_eq!(u32::from_le_bytes(packet[1..5].try_into().unwrap()), 1280);
        assert_eq!(u32::from_le_bytes(packet[5..9].try_into().unwrap()), 720);
        let rgba = image::RgbaImage::from_raw(1280, 720, packet[9..].to_vec()).unwrap();
        assert!(rgba.pixels().all(|pixel| pixel[3] == 255));
        let decoded = image::DynamicImage::ImageRgba8(rgba).to_rgb8();
        assert_eq!(decoded.dimensions(), (1280, 720));
        assert_eq!(decoded.as_raw(), &rgb);
        let jpeg = phone.try_recv().unwrap();
        assert_eq!(jpeg[0], 1);
        assert_eq!(
            image::load_from_memory(&jpeg[1..])
                .unwrap()
                .to_rgb8()
                .dimensions(),
            (640, 360)
        );
        assert_eq!(video.receiver_count(), 2);
    }

    #[test]
    fn phone_encoder_shares_the_party_packet_without_counting_as_party() {
        let video = Video::default();
        let mut rtc = video.subscribe_rtc();
        assert!(video.encoder_active());
        assert!(!video.party_active());
        let mut party = video.subscribe_party();
        let rgb: Vec<u8> = (0..1280 * 720 * 3).map(|i| (i % 7) as u8).collect();
        video.publish(&rgb, 1280, 720, 75).unwrap();
        let shared = rtc.try_recv().unwrap();
        assert_eq!(shared[0], 4);
        assert_eq!(shared.as_ptr(), party.try_recv().unwrap().as_ptr());
        drop(party);
        video.publish(&rgb, 1280, 720, 75).unwrap();
        assert_eq!(rtc.try_recv().unwrap()[0], 4);
        assert_eq!(video.receiver_count(), 1);
        drop(rtc);
        assert!(!video.encoder_active());
    }

    #[test]
    fn party_preserves_sixty_fps_without_changing_the_phone_default() {
        use std::time::Duration;
        let video = Video::default();
        assert_eq!(video.encoder_gap(), None);
        let rtc = video.subscribe_rtc();
        // Early frames of a 60 fps source still pass at 30 fps.
        assert_eq!(video.encoder_gap(), Some(Duration::from_micros(26_666)));
        video.set_rtc_frame_rate(60);
        assert_eq!(video.encoder_gap(), Some(Duration::from_micros(13_332)));
        video.set_rtc_frame_rate(500);
        assert_eq!(video.encoder_gap(), Some(Duration::from_micros(13_332)));
        let party = video.subscribe_party();
        video.set_rtc_frame_rate(30);
        assert_eq!(video.encoder_gap(), Some(Duration::from_micros(13_332)));
        drop(rtc);
        assert_eq!(video.encoder_gap(), Some(Duration::from_micros(13_332)));
        drop(party);
        assert_eq!(video.encoder_gap(), None);
    }

    #[test]
    fn raw_packets_are_sent_as_is_and_phones_still_get_rgb() {
        let video = Video::default();
        assert!(!video.takes_raw(1280, 720));
        let mut party = video.subscribe_party();
        let mut phone = video.subscribe(View::default());
        assert!(video.takes_raw(1280, 720));
        assert!(!video.takes_raw(640, 480));
        let mut packet = raw_packet(BGRX, 1280, 720);
        for _ in 0..1280 * 720 {
            packet.extend_from_slice(&[10, 20, 250, 0]);
        }
        let pointer = packet[PACKET_HEADER..].as_ptr();
        video.publish_packet(packet, 75).unwrap();
        let sent = party.try_recv().unwrap();
        assert_eq!(sent[0], BGRX);
        assert_eq!(sent[PACKET_HEADER..].as_ptr(), pointer);
        let jpeg = phone.try_recv().unwrap();
        let decoded = image::load_from_memory(&jpeg[1..]).unwrap().to_rgb8();
        assert_eq!(decoded.dimensions(), (640, 360));
        let pixel = decoded.get_pixel(320, 180);
        assert!(pixel[0] > 230 && pixel[2] < 30, "{pixel:?}");
    }

    #[test]
    fn small_party_frames_stay_lossless_png() {
        let rgb = vec![127; 320 * 240 * 3];
        let packet = party_packet(&rgb, 320, 240).unwrap();
        assert_eq!(packet[0], 3);
        assert_eq!(
            image::load_from_memory(&packet[1..])
                .unwrap()
                .to_rgb8()
                .as_raw(),
            &rgb
        );
    }

    #[test]
    #[ignore = "manual local-bridge throughput benchmark"]
    fn party_bridge_throughput() {
        // Busy, changing image: a 3D scene stresses PNG more than flat pixel art.
        let mut seed = 123u32;
        let rgb: Vec<u8> = (0..1280 * 720 * 3)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                seed as u8
            })
            .collect();
        for raw in [false, true] {
            let start = std::time::Instant::now();
            for _ in 0..30 {
                if raw {
                    std::hint::black_box(party_packet(&rgb, 1280, 720).unwrap());
                } else {
                    let mut out = Vec::new();
                    image::codecs::png::PngEncoder::new_with_quality(
                        &mut out,
                        image::codecs::png::CompressionType::Fast,
                        image::codecs::png::FilterType::NoFilter,
                    )
                    .write_image(&rgb, 1280, 720, image::ExtendedColorType::Rgb8)
                    .unwrap();
                    std::hint::black_box(out);
                }
            }
            println!(
                "720p bridge {}: {:.2} ms/frame",
                if raw { "RGBA" } else { "PNG" },
                start.elapsed().as_secs_f64() * 1000.0 / 30.0
            );
        }
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
