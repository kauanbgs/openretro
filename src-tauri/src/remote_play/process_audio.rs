//! Game-only sound for emulators that share none (RPCS3): Windows' process
//! loopback captures what that process and its children play, and nothing
//! else. Calls, notifications and browser audio stay on the host, as with
//! the runtime's own PCM. Needs Windows 10 version 2004 or later.
use axum::body::Bytes;
use std::{sync::mpsc, time::Duration};
use windows::{
    core::{Interface, Ref, HRESULT},
    Win32::{
        Media::Audio::{
            ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
            IActivateAudioInterfaceCompletionHandler,
            IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient,
            AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK,
            AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
            AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
            PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX, WAVE_FORMAT_PCM,
        },
        System::{
            Com::{
                CoInitializeEx, CoUninitialize, StructuredStorage::PROPVARIANT,
                StructuredStorage::PROPVARIANT_0, StructuredStorage::PROPVARIANT_0_0,
                StructuredStorage::PROPVARIANT_0_0_0, BLOB, COINIT_MULTITHREADED,
            },
            Variant::VT_BLOB,
        },
    },
};

const RATE: u32 = 48_000;
/// Interleaved stereo i16, the same PCM the runtime shares.
const FRAME_BYTES: usize = 4;

#[windows_core::implement(IActivateAudioInterfaceCompletionHandler)]
struct Activated(mpsc::SyncSender<()>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let _ = self.0.send(());
        Ok(())
    }
}

/// COM for the capturing thread, released after the interfaces using it.
struct Com;
impl Drop for Com {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

/// One process's sound. Lives on the thread that started it: COM is
/// initialized there and released when this drops.
pub struct ProcessAudio {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    _com: Com,
}

impl ProcessAudio {
    pub fn start(pid: u32) -> windows::core::Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
        let com = Com;
        let (client, capture) = Self::open(pid)?;
        Ok(Self {
            client,
            capture,
            _com: com,
        })
    }

    fn open(pid: u32) -> windows::core::Result<(IAudioClient, IAudioCaptureClient)> {
        let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                },
            },
        };
        let variant = PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_BLOB,
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 {
                        blob: BLOB {
                            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                            pBlobData: &mut params as *mut _ as *mut u8,
                        },
                    },
                }),
            },
        };
        let (done, activated) = mpsc::sync_channel(1);
        let handler: IActivateAudioInterfaceCompletionHandler = Activated(done).into();
        let operation = unsafe {
            ActivateAudioInterfaceAsync(
                VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                &IAudioClient::IID,
                Some(&variant),
                &handler,
            )?
        };
        // The blob points at `params`; it is not the PROPVARIANT's to free.
        std::mem::forget(variant);
        activated
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| windows::core::Error::from(HRESULT(0x8000_000Au32 as i32)))?;
        let mut result = HRESULT(0);
        let mut activated = None;
        unsafe { operation.GetActivateResult(&mut result, &mut activated)? };
        result.ok()?;
        let client: IAudioClient = activated
            .ok_or_else(|| windows::core::Error::from(HRESULT(0x8000_4005u32 as i32)))?
            .cast()?;
        // Process loopback has no mix format of its own; Windows converts
        // what the game plays to this.
        let format = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM as u16,
            nChannels: 2,
            nSamplesPerSec: RATE,
            nAvgBytesPerSec: RATE * FRAME_BYTES as u32,
            nBlockAlign: FRAME_BYTES as u16,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        unsafe {
            client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                2_000_000, // 200 ms, in 100 ns units
                0,
                &format,
                None,
            )?;
            let capture: IAudioCaptureClient = client.GetService()?;
            client.Start()?;
            Ok((client, capture))
        }
    }

    /// What the game played since the last read, as one sound packet, or
    /// None while it is silent.
    pub fn read(&mut self) -> windows::core::Result<Option<Bytes>> {
        let mut packet = vec![super::audio::AUDIO];
        packet.extend_from_slice(&RATE.to_le_bytes());
        unsafe {
            loop {
                let size = self.capture.GetNextPacketSize()?;
                if size == 0 {
                    break;
                }
                let (mut data, mut frames, mut flags) = (std::ptr::null_mut(), 0u32, 0u32);
                self.capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
                let bytes = frames as usize * FRAME_BYTES;
                if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                    packet.resize(packet.len() + bytes, 0);
                } else {
                    packet.extend_from_slice(std::slice::from_raw_parts(data, bytes));
                }
                self.capture.ReleaseBuffer(frames)?;
            }
        }
        Ok((packet.len() > 5).then(|| Bytes::from(packet)))
    }
}

impl Drop for ProcessAudio {
    fn drop(&mut self) {
        unsafe {
            let _ = self.client.Stop();
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "manual check of this PC's audio service"]
    fn captures_one_process_without_its_own_audio_device() {
        let mut capture = super::ProcessAudio::start(std::process::id()).unwrap();
        // This test plays nothing: silent PCM in the shared packet format.
        std::thread::sleep(std::time::Duration::from_millis(50));
        if let Some(packet) = capture.read().unwrap() {
            assert_eq!(&packet[..5], &[2, 128, 187, 0, 0]);
            assert_eq!((packet.len() - 5) % 4, 0);
        }
    }
}
