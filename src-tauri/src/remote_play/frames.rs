//! Reads the frames the runtime publishes in shared memory (see the runtime's
//! 0005 patch) and streams them. Software cores publish every frame at their
//! own resolution; GPU cores (N64, PSP, PS2) publish a readback of the
//! finished picture while OpenRetro marks a phone as watching. Both work with
//! the PC's screen off or covered.
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const MAGIC: u32 = 0x3246_524f;
const HEADER: usize = 32;
const MAX_BYTES: usize = 16 * 1024 * 1024;
/// Core frames are small pixel art and keep a high quality. Readbacks are
/// already smooth after scaling, so a lower one looks the same at a third of
/// the size.
const CORE_QUALITY: u8 = 88;
const READBACK_QUALITY: u8 = 75;
/// GPU readbacks are window-sized; they are scaled down to about a PS2's own
/// resolution. At 960x540 a frame took longer to encode than to play (~30 ms)
/// and more Wi-Fi than phones keep up with.
const MAX_WIDTH: usize = 640;
const MAX_HEIGHT: usize = 480;
const FILE_MAP_WRITE: u32 = 2;
const FILE_MAP_READ: u32 = 4;
/// Header fields, in u32 units.
const SEQUENCE: usize = 1;
const WANTED: usize = 6;

#[link(name = "kernel32")]
extern "system" {
    fn OpenFileMappingW(access: u32, inherit: i32, name: *const u16) -> *mut c_void;
    fn MapViewOfFile(mapping: *mut c_void, access: u32, high: u32, low: u32, size: usize) -> *mut c_void;
    fn UnmapViewOfFile(view: *const c_void) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
    fn GetTickCount() -> u32;
}

/// libretro pixel formats, plus the runtime's GPU readback.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Format {
    Rgb1555,
    Xrgb8888,
    Rgb565,
    /// B, G, R, A bytes with the bottom row first, as glReadPixels returns them.
    BgraFlipped,
}

impl Format {
    fn from(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::Rgb1555),
            1 => Some(Self::Xrgb8888),
            2 => Some(Self::Rgb565),
            100 => Some(Self::BgraFlipped),
            _ => None,
        }
    }
    fn bytes(self) -> usize {
        match self {
            Self::Xrgb8888 | Self::BgraFlipped => 4,
            Self::Rgb1555 | Self::Rgb565 => 2,
        }
    }
}

/// Core frames keep their size so pixel art stays sharp on the phone;
/// window-sized readbacks are scaled to fit the stream.
fn output_size(width: usize, height: usize, format: Format) -> (usize, usize) {
    if format != Format::BgraFlipped || (width <= MAX_WIDTH && height <= MAX_HEIGHT) {
        return (width, height);
    }
    let scale = (MAX_WIDTH as f64 / width as f64).min(MAX_HEIGHT as f64 / height as f64);
    (
        ((width as f64 * scale).round() as usize).max(1),
        ((height as f64 * scale).round() as usize).max(1),
    )
}

/// Converts one frame to packed RGB with nearest-neighbour sampling.
fn to_rgb(
    data: &[u8],
    width: usize,
    height: usize,
    pitch: usize,
    format: Format,
    out: &mut Vec<u8>,
) -> (usize, usize) {
    let (w, h) = output_size(width, height, format);
    out.clear();
    out.reserve(w * h * 3);
    let expand5 = |v: u16| ((v << 3) | (v >> 2)) as u8;
    for y in 0..h {
        let mut source = y * height / h;
        if format == Format::BgraFlipped {
            source = height - 1 - source;
        }
        let row = &data[source * pitch..source * pitch + width * format.bytes()];
        for x in 0..w {
            let at = x * width / w * format.bytes();
            let px = &row[at..at + format.bytes()];
            match format {
                Format::Xrgb8888 | Format::BgraFlipped => out.extend_from_slice(&[px[2], px[1], px[0]]),
                Format::Rgb565 => {
                    let v = u16::from_le_bytes([px[0], px[1]]);
                    let g = (v >> 5) & 0x3f;
                    out.extend_from_slice(&[expand5(v >> 11), ((g << 2) | (g >> 4)) as u8, expand5(v & 0x1f)]);
                }
                Format::Rgb1555 => {
                    let v = u16::from_le_bytes([px[0], px[1]]);
                    out.extend_from_slice(&[expand5((v >> 10) & 0x1f), expand5((v >> 5) & 0x1f), expand5(v & 0x1f)]);
                }
            }
        }
    }
    (w, h)
}

struct Mapping {
    handle: *mut c_void,
    view: *mut u8,
}

impl Mapping {
    fn open(pid: u32) -> Option<Self> {
        let name: Vec<u16> = format!("Local\\OpenRetroFrames-{pid}")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let access = FILE_MAP_READ | FILE_MAP_WRITE;
        unsafe {
            let handle = OpenFileMappingW(access, 0, name.as_ptr());
            if handle.is_null() {
                return None;
            }
            let view = MapViewOfFile(handle, access, 0, 0, 0) as *mut u8;
            if view.is_null() {
                CloseHandle(handle);
                return None;
            }
            Some(Self { handle, view })
        }
    }

    fn field(&self, index: usize) -> u32 {
        unsafe { std::ptr::read_volatile((self.view as *const u32).add(index)) }
    }

    /// Tells the runtime a phone is watching, so GPU cores read frames back.
    fn want(&self) {
        unsafe { std::ptr::write_volatile((self.view as *mut u32).add(WANTED), GetTickCount()) };
    }

    /// Copies the latest complete frame, or None while one is being written.
    fn read(&self, last: u32, buffer: &mut Vec<u8>) -> Option<(u32, Format, usize, usize, usize)> {
        if self.field(0) != MAGIC {
            return None;
        }
        let sequence = self.field(SEQUENCE);
        if sequence == last || sequence % 2 == 1 {
            return None;
        }
        std::sync::atomic::fence(Ordering::Acquire);
        let (width, height, pitch) = (self.field(2) as usize, self.field(3) as usize, self.field(4) as usize);
        let format = Format::from(self.field(5))?;
        let size = pitch.checked_mul(height)?;
        if width == 0 || height == 0 || size > MAX_BYTES || pitch < width * format.bytes() {
            return None;
        }
        buffer.resize(size, 0);
        unsafe { std::ptr::copy_nonoverlapping(self.view.add(HEADER), buffer.as_mut_ptr(), size) };
        std::sync::atomic::fence(Ordering::Acquire);
        // A frame written while copying is skipped; the next poll gets it.
        (self.field(SEQUENCE) == sequence).then_some((sequence, format, width, height, pitch))
    }
}

impl Drop for Mapping {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(self.view as *const c_void);
            CloseHandle(self.handle);
        }
    }
}

/// Milliseconds since the Unix epoch, for comparing across threads.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

pub struct SharedFrames {
    stop: Arc<AtomicBool>,
}

impl SharedFrames {
    /// `last_frame` records when a shared frame was last sent (see `now_ms`);
    /// screen capture stays quiet while it is recent.
    pub fn start(
        app: tauri::AppHandle,
        frames: super::video::Video,
        last_frame: Arc<AtomicU64>,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        // Encoding runs beside reading, so the next frame is converted while
        // the previous one encodes. One frame waits at most; when the encoder
        // falls behind, newer frames are dropped instead of queueing up.
        let (encode, encoded) = std::sync::mpsc::sync_channel::<(Vec<u8>, u32, u32, u8)>(1);
        let sender = frames.clone();
        std::thread::spawn(move || {
            for (rgb, w, h, quality) in encoded {
                if sender.publish(&rgb, w, h, quality).is_ok() {
                    last_frame.store(now_ms(), Ordering::Release);
                }
            }
        });
        std::thread::spawn(move || {
            let (mut mapping, mut pid) = (None::<Mapping>, 0u32);
            let (mut sequence, mut raw, mut rgb) = (0u32, Vec::new(), Vec::new());
            let mut checked = Instant::now() - Duration::from_secs(1);
            while !flag.load(Ordering::Acquire) {
                if checked.elapsed() > Duration::from_millis(500) {
                    checked = Instant::now();
                    let running = crate::in_game::runtime_pid(&app).unwrap_or(0);
                    if running != pid || mapping.is_none() {
                        pid = running;
                        mapping = (pid != 0).then(|| Mapping::open(pid)).flatten();
                        sequence = 0;
                    }
                    if let Some(mapping) = mapping.as_ref().filter(|_| frames.receiver_count() > 0) {
                        mapping.want();
                    }
                }
                let read = mapping.as_ref().and_then(|m| m.read(sequence, &mut raw));
                let Some((next, format, width, height, pitch)) = read else {
                    std::thread::sleep(Duration::from_millis(3));
                    continue;
                };
                sequence = next;
                if frames.receiver_count() == 0 {
                    continue;
                }
                let (w, h) = to_rgb(&raw, width, height, pitch, format, &mut rgb);
                let quality = if format == Format::BgraFlipped { READBACK_QUALITY } else { CORE_QUALITY };
                match encode.try_send((std::mem::take(&mut rgb), w as u32, h as u32, quality)) {
                    Ok(()) => {}
                    Err(std::sync::mpsc::TrySendError::Full((back, ..))) => rgb = back,
                    Err(std::sync::mpsc::TrySendError::Disconnected(_)) => break,
                }
            }
        });
        Self { stop }
    }
}

impl Drop for SharedFrames {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_every_libretro_format() {
        let mut out = Vec::new();
        // XRGB8888 is stored as B, G, R, X; the second row sits after padding.
        let xrgb = [1, 2, 3, 0, 9, 9, 9, 9, 4, 5, 6, 0, 9, 9, 9, 9];
        assert_eq!(to_rgb(&xrgb, 1, 2, 8, Format::Xrgb8888, &mut out), (1, 2));
        assert_eq!(out, [3, 2, 1, 6, 5, 4]);
        to_rgb(&0xf800u16.to_le_bytes(), 1, 1, 2, Format::Rgb565, &mut out);
        assert_eq!(out, [255, 0, 0]);
        to_rgb(&0x07e0u16.to_le_bytes(), 1, 1, 2, Format::Rgb565, &mut out);
        assert_eq!(out, [0, 255, 0]);
        to_rgb(&0x001fu16.to_le_bytes(), 1, 1, 2, Format::Rgb1555, &mut out);
        assert_eq!(out, [0, 0, 255]);
        assert_eq!(Format::from(7), None);
    }

    #[test]
    fn gpu_readbacks_are_flipped_and_fit_the_stream() {
        let mut out = Vec::new();
        // Bottom row first: the top row of the picture is the second one.
        let bgra = [1, 2, 3, 255, 7, 8, 9, 255];
        assert_eq!(to_rgb(&bgra, 1, 2, 4, Format::BgraFlipped, &mut out), (1, 2));
        assert_eq!(out, [9, 8, 7, 3, 2, 1]);
        assert_eq!(output_size(1920, 1080, Format::BgraFlipped), (640, 360));
        assert_eq!(output_size(1440, 1080, Format::BgraFlipped), (640, 480));
        assert_eq!(output_size(640, 448, Format::BgraFlipped), (640, 448));
        assert_eq!(output_size(1920, 1080, Format::Xrgb8888), (1920, 1080));
    }
}
