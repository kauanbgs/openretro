//! Reads game-only PCM from the managed runtime, or RPCS3's own process
//! sound (`process_audio`). Never records a system output device: calls,
//! notifications and browser audio stay on the host.
use axum::body::Bytes;
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::broadcast;

pub const AUDIO: u8 = 2;
const MAGIC: u32 = 0x3141_524f;
const HEADER: usize = 32;
const FRAMES: usize = 16384;
const RING_BYTES: usize = FRAMES * 4; // interleaved stereo i16
const FILE_MAP_READ: u32 = 4;

#[link(name = "kernel32")]
extern "system" {
    fn OpenFileMappingW(access: u32, inherit: i32, name: *const u16) -> *mut c_void;
    fn MapViewOfFile(
        mapping: *mut c_void,
        access: u32,
        high: u32,
        low: u32,
        size: usize,
    ) -> *mut c_void;
    fn UnmapViewOfFile(view: *const c_void) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

#[derive(Default)]
struct Cursor {
    written: Option<u32>,
    rate: u32,
}
impl Cursor {
    fn packet(&mut self, ring: &[u8], written: u32, rate: u32) -> Option<Bytes> {
        if ring.len() != RING_BYTES || !(8000..=192000).contains(&rate) {
            return None;
        }
        let previous = self.written.replace(written);
        if previous.is_none() || self.rate != rate {
            // Start at live audio, not at stale samples from before joining.
            self.rate = rate;
            return None;
        }
        let available = written.wrapping_sub(previous.unwrap()) as usize;
        let frames = available.min(FRAMES).min((rate / 10) as usize);
        if frames == 0 {
            return None;
        }
        let start = written.wrapping_sub(frames as u32) as usize % FRAMES;
        let first = frames.min(FRAMES - start);
        let mut packet = Vec::with_capacity(5 + frames * 4);
        packet.push(AUDIO);
        packet.extend_from_slice(&rate.to_le_bytes());
        packet.extend_from_slice(&ring[start * 4..(start + first) * 4]);
        packet.extend_from_slice(&ring[..(frames - first) * 4]);
        Some(Bytes::from(packet))
    }
}

struct Mapping {
    handle: *mut c_void,
    view: *const u8,
    ring: Vec<u8>,
    cursor: Cursor,
}
impl Mapping {
    fn open(pid: u32) -> Option<Self> {
        let name: Vec<u16> = format!("Local\\OpenRetroAudio-{pid}")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        unsafe {
            let handle = OpenFileMappingW(FILE_MAP_READ, 0, name.as_ptr());
            if handle.is_null() {
                return None;
            }
            // Explicit size makes Windows reject a mapping shorter than the protocol.
            let view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, HEADER + RING_BYTES) as *const u8;
            if view.is_null() {
                CloseHandle(handle);
                return None;
            }
            Some(Self {
                handle,
                view,
                ring: vec![0; RING_BYTES],
                cursor: Cursor::default(),
            })
        }
    }
    fn field(&self, index: usize) -> u32 {
        unsafe { std::ptr::read_volatile((self.view as *const u32).add(index)) }
    }
    fn read(&mut self) -> Option<Bytes> {
        if self.field(0) != MAGIC || self.field(4) != FRAMES as u32 || self.field(5) != 2 {
            return None;
        }
        let sequence = self.field(1);
        if sequence % 2 != 0 {
            return None;
        }
        std::sync::atomic::fence(Ordering::Acquire);
        let (written, rate) = (self.field(2), self.field(3));
        unsafe {
            std::ptr::copy_nonoverlapping(
                self.view.add(HEADER),
                self.ring.as_mut_ptr(),
                RING_BYTES,
            );
        }
        std::sync::atomic::fence(Ordering::Acquire);
        if self.field(1) != sequence {
            return None;
        }
        self.cursor.packet(&self.ring, written, rate)
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

pub struct AudioCapture {
    stop: Arc<AtomicBool>,
}
impl AudioCapture {
    pub fn start(app: tauri::AppHandle, sound: broadcast::Sender<Bytes>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        std::thread::spawn(move || {
            let (mut mapping, mut pid) = (None::<Mapping>, 0u32);
            // RPCS3 shares no PCM; its process is captured instead, once
            // per game: a failure would otherwise repeat every 100 ms.
            let (mut process, mut tried) = (None::<super::process_audio::ProcessAudio>, 0u32);
            let mut checked = Instant::now() - Duration::from_secs(1);
            while !flag.load(Ordering::Acquire) {
                if checked.elapsed() >= Duration::from_millis(100) {
                    let running = crate::in_game::runtime_pid(&app).unwrap_or(0);
                    if running != pid {
                        mapping = None;
                        process = None;
                        pid = running;
                    }
                    match crate::in_game::unshared_audio_pid(&app) {
                        Some(game) if game == pid => {
                            if process.is_none() && tried != pid {
                                tried = pid;
                                match super::process_audio::ProcessAudio::start(pid) {
                                    Ok(capture) => process = Some(capture),
                                    Err(e) => log::warn!("Game sound capture unavailable: {e}"),
                                }
                            }
                        }
                        _ if pid != 0 && mapping.is_none() => mapping = Mapping::open(pid),
                        _ => {}
                    }
                    checked = Instant::now();
                }
                if let Some(capture) = process.as_mut() {
                    // Read even without listeners, so a guest who joins
                    // hears live sound instead of the buffered past.
                    match capture.read() {
                        Ok(Some(packet)) if sound.receiver_count() > 0 => {
                            let _ = sound.send(packet);
                        }
                        Ok(_) => {}
                        Err(e) => {
                            log::warn!("Game sound capture stopped: {e}");
                            process = None;
                        }
                    }
                } else if sound.receiver_count() > 0 {
                    if let Some(packet) = mapping.as_mut().and_then(Mapping::read) {
                        let _ = sound.send(packet);
                    }
                }
                std::thread::sleep(Duration::from_millis(3));
            }
        });
        Self { stop }
    }
}
impl Drop for AudioCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(ring: &mut [u8], at: usize, left: i16, right: i16) {
        ring[at * 4..at * 4 + 2].copy_from_slice(&left.to_le_bytes());
        ring[at * 4 + 2..at * 4 + 4].copy_from_slice(&right.to_le_bytes());
    }
    #[test]
    fn reads_only_the_selected_runtime_mapping_and_rejects_incomplete_writes() {
        #[link(name = "kernel32")]
        extern "system" {
            fn CreateFileMappingW(
                file: *mut c_void,
                attributes: *const c_void,
                protection: u32,
                high: u32,
                low: u32,
                name: *const u16,
            ) -> *mut c_void;
        }
        let pid = std::process::id();
        let name: Vec<u16> = format!("Local\\OpenRetroAudio-{pid}")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        unsafe {
            let handle = CreateFileMappingW(
                -1isize as *mut c_void,
                std::ptr::null(),
                4,
                0,
                (HEADER + RING_BYTES) as u32,
                name.as_ptr(),
            );
            assert!(!handle.is_null());
            let view = MapViewOfFile(handle, 6, 0, 0, HEADER + RING_BYTES) as *mut u8;
            assert!(!view.is_null());
            // Mapping's Drop also releases this test publisher's writable view.
            let publisher = Mapping {
                handle,
                view,
                ring: Vec::new(),
                cursor: Cursor::default(),
            };
            let fields = view as *mut u32;
            fields.add(0).write(MAGIC);
            fields.add(3).write(48000);
            fields.add(4).write(FRAMES as u32);
            fields.add(5).write(2);
            let mut reader = Mapping::open(pid).unwrap();
            assert!(Mapping::open(u32::MAX).is_none());
            assert!(reader.read().is_none());
            fields.add(1).write_volatile(1);
            std::ptr::copy_nonoverlapping([1u8, 2, 3, 4].as_ptr(), view.add(HEADER), 4);
            fields.add(2).write(1);
            assert!(reader.read().is_none());
            fields.add(1).write_volatile(2);
            let packet = reader.read().unwrap();
            assert_eq!(&packet[5..], &[1, 2, 3, 4]);
            assert!(reader.read().is_none());
            drop(reader);
            drop(publisher);
        }
    }

    #[test]
    fn starts_live_and_preserves_stereo_pcm_format() {
        let mut ring = vec![0; RING_BYTES];
        sample(&mut ring, 10, 1000, -2000);
        let mut cursor = Cursor::default();
        assert!(cursor.packet(&ring, 10, 48000).is_none());
        let packet = cursor.packet(&ring, 11, 48000).unwrap();
        assert_eq!(&packet[..5], &[2, 128, 187, 0, 0]);
        assert_eq!(&packet[5..], &[232, 3, 48, 248]);
        assert!(cursor.packet(&ring, 11, 48000).is_none());
    }
    #[test]
    fn ring_and_u32_counter_wrap_keep_samples_in_order() {
        let mut ring = vec![0; RING_BYTES];
        sample(&mut ring, FRAMES - 1, 1, 2);
        sample(&mut ring, 0, 3, 4);
        let mut cursor = Cursor::default();
        cursor.packet(&ring, u32::MAX, 44100);
        let packet = cursor.packet(&ring, 1, 44100).unwrap();
        assert_eq!(&packet[5..], &[1, 0, 2, 0, 3, 0, 4, 0]);
    }
    #[test]
    fn slow_readers_drop_old_audio_and_rate_changes_restart_live() {
        let ring = vec![0; RING_BYTES];
        let mut cursor = Cursor::default();
        cursor.packet(&ring, 0, 48000);
        assert_eq!(
            cursor.packet(&ring, 48000, 48000).unwrap().len(),
            5 + 4800 * 4
        );
        assert!(cursor.packet(&ring, 49000, 44100).is_none());
        assert_eq!(cursor.packet(&ring, 49010, 44100).unwrap().len(), 45);
    }
    #[test]
    fn malformed_buffers_and_sample_rates_are_rejected() {
        let mut cursor = Cursor::default();
        assert!(cursor.packet(&[], 1, 48000).is_none());
        assert!(cursor.packet(&vec![0; RING_BYTES], 1, 0).is_none());
        assert!(cursor.written.is_none());
    }
}
