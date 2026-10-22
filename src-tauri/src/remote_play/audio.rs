//! Records what the PC plays (WASAPI loopback on the default output) and
//! sends it to phones as 16-bit stereo PCM.
use axum::body::Bytes;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::broadcast;

/// The first byte of every audio message, followed by the sample rate as a
/// little-endian u32 and interleaved stereo i16 samples.
pub const AUDIO: u8 = 2;

/// Mixes any channel layout down to stereo i16.
fn stereo(samples: &[f32], channels: usize, rate: u32) -> Vec<u8> {
    let mut packet = Vec::with_capacity(5 + samples.len() / channels.max(1) * 4);
    packet.push(AUDIO);
    packet.extend_from_slice(&rate.to_le_bytes());
    for frame in samples.chunks(channels.max(1)) {
        let (left, right) = match frame {
            [mono] => (*mono, *mono),
            [left, right, ..] => (*left, *right),
            [] => (0.0, 0.0),
        };
        for sample in [left, right] {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            packet.extend_from_slice(&value.to_le_bytes());
        }
    }
    packet
}

pub struct AudioCapture {
    stop: Arc<AtomicBool>,
}

impl AudioCapture {
    /// Sound is optional: without an output device the stream continues mute.
    pub fn start(sound: broadcast::Sender<Bytes>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        // cpal streams are not Send, so one thread owns the stream until stopped.
        std::thread::spawn(move || {
            let result = (|| -> Result<(), String> {
                let device = cpal::default_host()
                    .default_output_device()
                    .ok_or("Nenhuma saída de áudio encontrada.")?;
                let config = device.default_output_config().map_err(|e| e.to_string())?;
                let (channels, rate) = (config.channels() as usize, config.sample_rate());
                let stream = device
                    .build_input_stream(
                        config.config(),
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            if sound.receiver_count() > 0 {
                                let _ = sound.send(Bytes::from(stereo(data, channels, rate)));
                            }
                        },
                        |error| log::warn!("Phone play audio: {error}"),
                        None,
                    )
                    .map_err(|e| e.to_string())?;
                stream.play().map_err(|e| e.to_string())?;
                while !flag.load(Ordering::Acquire) {
                    std::thread::park_timeout(std::time::Duration::from_millis(200));
                }
                Ok(())
            })();
            if let Err(message) = result {
                log::warn!("Phone play audio unavailable: {message}");
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

    #[test]
    fn mixes_to_stereo_with_a_header() {
        let packet = stereo(&[1.0, -1.0, 0.9, 0.5, 0.0, 0.0], 3, 48000);
        assert_eq!(packet[0], AUDIO);
        assert_eq!(&packet[1..5], &48000u32.to_le_bytes());
        let samples: Vec<i16> = packet[5..]
            .chunks(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        assert_eq!(samples, vec![i16::MAX, -i16::MAX, 16383, 0]);
        assert_eq!(stereo(&[0.25], 1, 44100)[5..].len(), 4);
    }
}
