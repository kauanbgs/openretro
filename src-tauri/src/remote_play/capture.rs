//! Captures what the PC shows with Windows Graphics Capture and turns each
//! frame into a small JPEG. It covers OpenRetro's own screens and any game
//! whose runtime shares no frames; the runtime's shared frames take over as
//! soon as they arrive. The runtime draws with OpenGL into a child of
//! OpenRetro's window, which window capture leaves out, so this captures the
//! monitor and crops the game's area (or OpenRetro's window) on the GPU. It
//! sends nothing while another app is in front, which the crop would show.
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
};

/// Frames larger than this are scaled down; retro games stay sharp well below it.
const MAX_WIDTH: u32 = 960;
const MAX_HEIGHT: u32 = 540;
const QUALITY: u8 = 72;
const FRAME_INTERVAL: Duration = Duration::from_millis(15);

type Error = Box<dyn std::error::Error + Send + Sync>;

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
#[repr(C)]
#[derive(Default)]
struct Point {
    x: i32,
    y: i32,
}
#[repr(C)]
struct MonitorInfo {
    size: u32,
    monitor: Rect,
    work: Rect,
    flags: u32,
}
#[link(name = "user32")]
extern "system" {
    fn GetClientRect(window: *mut c_void, rect: *mut Rect) -> i32;
    fn ClientToScreen(window: *mut c_void, point: *mut Point) -> i32;
    fn IsIconic(window: *mut c_void) -> i32;
    fn MonitorFromWindow(window: *mut c_void, flags: u32) -> *mut c_void;
    fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MonitorInfo) -> i32;
    fn GetForegroundWindow() -> *mut c_void;
    fn GetWindowThreadProcessId(window: *mut c_void, pid: *mut u32) -> u32;
}
const MONITOR_DEFAULTTONEAREST: u32 = 2;

/// Whether OpenRetro or the game is the window in front. The monitor shows
/// whatever covers OpenRetro's area, so with another app in front a frame
/// would send the PC's desktop and other apps to guests and phones.
fn in_front(runtime: Option<u32>) -> bool {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(GetForegroundWindow(), &mut pid) };
    pid != 0 && (pid == std::process::id() || Some(pid) == runtime)
}

/// A window's client area in screen pixels, or None while minimized.
fn client_on_screen(window: isize) -> Option<Rect> {
    let window = window as *mut c_void;
    let mut rect = Rect::default();
    let mut origin = Point::default();
    unsafe {
        if IsIconic(window) != 0
            || GetClientRect(window, &mut rect) == 0
            || ClientToScreen(window, &mut origin) == 0
        {
            return None;
        }
    }
    Some(Rect {
        left: origin.x,
        top: origin.y,
        right: origin.x + rect.right,
        bottom: origin.y + rect.bottom,
    })
}

/// The part of `area` inside a monitor frame, in frame pixels.
fn crop(area: Rect, monitor: Rect, width: u32, height: u32) -> Option<(u32, u32, u32, u32)> {
    let clamp = |value: i32, max: u32| value.clamp(0, max as i32) as u32;
    let (x0, y0) = (
        clamp(area.left - monitor.left, width),
        clamp(area.top - monitor.top, height),
    );
    let (x1, y1) = (
        clamp(area.right - monitor.left, width),
        clamp(area.bottom - monitor.top, height),
    );
    (x1 > x0 && y1 > y0).then_some((x0, y0, x1, y1))
}

pub struct Target {
    pub app: tauri::AppHandle,
    pub main: isize,
    pub frames: super::video::Video,
    /// When the runtime last shared a frame itself; those take precedence.
    pub shared: Arc<AtomicU64>,
    monitor: Rect,
}

struct Handler {
    target: Target,
    rgb: Vec<u8>,
    sent: Option<Instant>,
}

/// Nearest-neighbour scaling keeps pixel art crisp and costs one read per pixel.
fn fit(width: u32, height: u32, party: bool) -> (u32, u32) {
    let (max_width, max_height) = if party {
        (1280, 720)
    } else {
        (MAX_WIDTH, MAX_HEIGHT)
    };
    let scale = (max_width as f64 / width as f64)
        .min(max_height as f64 / height as f64)
        .min(1.0);
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

/// Appends `w`×`h` samples of an RGBA frame to `out`: RGB for phone JPEGs,
/// or all four bytes for an encoder's raw packet, whose unscaled rows are
/// copied whole.
fn downscale(
    rgba: &[u8],
    pitch: usize,
    (width, height): (u32, u32),
    (w, h): (u32, u32),
    channels: usize,
    out: &mut Vec<u8>,
) {
    out.reserve(w as usize * h as usize * channels);
    for y in 0..h {
        let row = (y as u64 * height as u64 / h as u64) as usize * pitch;
        if channels == 4 && w == width {
            out.extend_from_slice(&rgba[row..row + width as usize * 4]);
            continue;
        }
        for x in 0..w {
            let at = row + (x as u64 * width as u64 / w as u64) as usize * 4;
            out.extend_from_slice(&rgba[at..at + channels]);
        }
    }
}

impl GraphicsCaptureApiHandler for Handler {
    type Flags = Target;
    type Error = Error;

    fn new(context: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            target: context.flags,
            rgb: Vec::new(),
            sent: None,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        // About 60 frames a second at most. Windows 10 cannot set a minimum
        // update interval on the capture itself, so the handler skips frames.
        let shared = self.target.shared.load(Ordering::Acquire);
        if self.target.frames.receiver_count() == 0
            || self.sent.is_some_and(|sent| {
                sent.elapsed() < self.target.frames.encoder_gap().unwrap_or(FRAME_INTERVAL)
            })
            || super::frames::now_ms().saturating_sub(shared) < 500
        {
            return Ok(());
        }
        if !in_front(crate::in_game::runtime_pid(&self.target.app)) {
            return Ok(());
        }
        let shown = crate::in_game::embedded_window(&self.target.app).unwrap_or(self.target.main);
        let Some(area) = client_on_screen(shown) else {
            return Ok(());
        };
        let Some((x0, y0, x1, y1)) = crop(area, self.target.monitor, frame.width(), frame.height())
        else {
            return Ok(());
        };
        self.sent = Some(Instant::now());
        let mut buffer = frame.buffer_crop(x0, y0, x1, y1)?;
        let (width, height, pitch) = (buffer.width(), buffer.height(), buffer.row_pitch() as usize);
        let frames = &self.target.frames;
        let (w, h) = fit(width, height, frames.encoder_active());
        let raw = buffer.as_raw_buffer();
        // A lagging phone skips frames instead of falling behind.
        if frames.takes_raw(w, h) {
            let mut packet = super::video::raw_packet(super::video::RGBX, w, h);
            downscale(raw, pitch, (width, height), (w, h), 4, &mut packet);
            frames.publish_packet(packet, QUALITY)?;
        } else {
            self.rgb.clear();
            downscale(raw, pitch, (width, height), (w, h), 3, &mut self.rgb);
            frames.publish(&self.rgb, w, h, QUALITY)?;
        }
        Ok(())
    }
}

pub struct VideoCapture(Option<CaptureControl<Handler, Error>>);

impl VideoCapture {
    pub fn start(
        app: tauri::AppHandle,
        main: isize,
        frames: super::video::Video,
        shared: Arc<AtomicU64>,
    ) -> crate::database::Result<Self> {
        let handle = unsafe { MonitorFromWindow(main as *mut c_void, MONITOR_DEFAULTTONEAREST) };
        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            monitor: Rect::default(),
            work: Rect::default(),
            flags: 0,
        };
        if handle.is_null() || unsafe { GetMonitorInfoW(handle, &mut info) } == 0 {
            return Err("Não foi possível encontrar a tela do OpenRetro.".into());
        }
        let settings = Settings::new(
            Monitor::from_raw_hmonitor(handle),
            CursorCaptureSettings::WithoutCursor,
            // Windows 10 cannot hide the capture border or set an update
            // interval; the defaults work on every supported version.
            DrawBorderSettings::Default,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Rgba8,
            Target {
                app,
                main,
                frames,
                shared,
                monitor: info.monitor,
            },
        );
        let control = Handler::start_free_threaded(settings)
            .map_err(|e| format!("Não foi possível capturar a tela do jogo: {e}"))?;
        Ok(Self(Some(control)))
    }
}

impl Drop for VideoCapture {
    fn drop(&mut self) {
        if let Some(control) = self.0.take() {
            let _ = control.stop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_fit_the_stream_and_keep_their_shape() {
        assert_eq!(fit(1920, 1080, false), (960, 540));
        assert_eq!(fit(1440, 1080, false), (720, 540));
        assert_eq!(fit(640, 480, false), (640, 480));
    }

    #[test]
    fn crops_the_visible_part_of_a_window() {
        let monitor = Rect {
            left: -1920,
            top: 0,
            right: 0,
            bottom: 1080,
        };
        let window = Rect {
            left: -1000,
            top: 100,
            right: 200,
            bottom: 700,
        };
        assert_eq!(
            crop(window, monitor, 1920, 1080),
            Some((920, 100, 1920, 700))
        );
        let elsewhere = Rect {
            left: 10,
            top: 10,
            right: 50,
            bottom: 50,
        };
        assert_eq!(crop(elsewhere, monitor, 1920, 1080), None);
    }

    #[test]
    fn downscale_samples_rgb_and_skips_row_padding() {
        // 4x2 RGBA with 4 bytes of padding per row.
        let mut rgba = Vec::new();
        for y in 0..2u8 {
            for x in 0..4u8 {
                rgba.extend_from_slice(&[x, y, 9, 255]);
            }
            rgba.extend_from_slice(&[0; 4]);
        }
        let mut out = Vec::new();
        downscale(&rgba, 20, (4, 2), (4, 2), 3, &mut out);
        assert_eq!(&out[..6], &[0, 0, 9, 1, 0, 9]);
        assert_eq!(&out[12..15], &[0, 1, 9]);
        // Raw packets keep every byte; whole rows and samples alike.
        for target in [(4, 2), (2, 1)] {
            let mut packet = vec![7];
            downscale(&rgba, 20, (4, 2), target, 4, &mut packet);
            let expected: Vec<u8> = if target == (4, 2) {
                [&rgba[..16], &rgba[20..36]].concat()
            } else {
                [&rgba[..4], &rgba[8..12]].concat()
            };
            assert_eq!(packet[1..], expected[..]);
        }
    }
}
