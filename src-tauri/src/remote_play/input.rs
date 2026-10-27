//! Relays a phone's pad to the runtime's remote gamepad. RetroArch reads one
//! `struct remote_message` per datagram, each changing one button or axis,
//! so transitions are sent immediately and held states are periodically refreshed.
//! A PS3 game hosted for a Party reads the same pads through `xinput`.
use super::REMOTE_PAD_BASE_PORT;
use std::{
    net::UdpSocket,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

const DEVICE_JOYPAD: i32 = 1;
const DEVICE_ANALOG: i32 = 5;

/// N64 games steer with the analog stick and mostly ignore the D-pad, which
/// is all a keyboard or a touch pad has. While one runs, remote D-pads move
/// the left stick instead.
static DPAD_AS_STICK: AtomicBool = AtomicBool::new(false);

pub fn dpad_as_stick(platform: &str) {
    DPAD_AS_STICK.store(platform == "n64", Ordering::Relaxed);
}

const UP: u16 = 1 << 4;
const DOWN: u16 = 1 << 5;
const LEFT: u16 = 1 << 6;
const RIGHT: u16 = 1 << 7;

/// A pad that already moves its stick keeps its D-pad as it is.
fn stick_from_dpad(state: PadState) -> PadState {
    let dpad = state.buttons & (UP | DOWN | LEFT | RIGHT);
    if dpad == 0 || state.axes[0] != 0 || state.axes[1] != 0 {
        return state;
    }
    let axis = |minus: u16, plus: u16| match (dpad & minus != 0, dpad & plus != 0) {
        (true, false) => -32767,
        (false, true) => 32767,
        _ => 0,
    };
    PadState {
        buttons: state.buttons & !dpad,
        axes: [axis(LEFT, RIGHT), axis(UP, DOWN), state.axes[2], state.axes[3]],
    }
}

/// What a phone reports: RetroPad buttons as a bitmask in libretro order
/// (B, Y, Select, Start, Up, Down, Left, Right, A, X, L, R, L2, R2, L3, R3)
/// and the left and right sticks as x, y pairs.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct PadState {
    pub buttons: u16,
    pub axes: [i16; 4],
}

/// `struct remote_message { int port, device, index, id; uint16_t state; }`,
/// padded to 20 bytes as the runtime's compiler lays it out.
fn message(device: i32, index: i32, id: i32, state: u16) -> [u8; 20] {
    let mut packet = [0u8; 20];
    for (slot, value) in [0, device, index, id].into_iter().enumerate() {
        packet[slot * 4..slot * 4 + 4].copy_from_slice(&value.to_le_bytes());
    }
    packet[16..18].copy_from_slice(&state.to_le_bytes());
    packet
}

/// Datagrams that turn `from` into `to`.
pub fn changes(from: PadState, to: PadState) -> Vec<[u8; 20]> {
    let mut packets = Vec::new();
    for id in 0..16 {
        let bit = 1u16 << id;
        if (from.buttons ^ to.buttons) & bit != 0 {
            packets.push(message(
                DEVICE_JOYPAD,
                0,
                id,
                u16::from(to.buttons & bit != 0),
            ));
        }
    }
    for (axis, (old, new)) in from.axes.iter().zip(to.axes).enumerate() {
        if *old != new {
            let (stick, id) = (axis as i32 / 2, axis as i32 % 2);
            packets.push(message(DEVICE_ANALOG, stick, id, new as u16));
        }
    }
    packets
}

pub struct Relay {
    socket: UdpSocket,
    player: u8,
    state: PadState,
    synced: Instant,
    base_port: u16,
    /// A real pad message arrived for this player: a PS3 game sees its pad.
    plugged: bool,
}

impl Relay {
    pub fn new() -> std::io::Result<Self> {
        Ok(Self {
            socket: UdpSocket::bind("127.0.0.1:0")?,
            player: 1,
            state: PadState::default(),
            synced: Instant::now() - Duration::from_secs(1),
            base_port: REMOTE_PAD_BASE_PORT,
            plugged: false,
        })
    }

    fn send(&self, packets: Vec<[u8; 20]>) {
        let target = ("127.0.0.1", self.base_port + u16::from(self.player) - 1);
        for packet in packets {
            // No runtime listening only means no game is running yet.
            let _ = self.socket.send_to(&packet, target);
        }
    }

    /// A pad's state, as the phone reported it.
    pub fn update(&mut self, state: PadState) {
        let state = if DPAD_AS_STICK.load(Ordering::Relaxed) {
            stick_from_dpad(state)
        } else {
            state
        };
        self.apply(state);
        #[cfg(windows)]
        if self.has_pads() {
            super::xinput::set(self.player, Some(state));
            self.plugged = true;
        }
    }

    fn apply(&mut self, state: PadState) {
        if state != PadState::default() && self.synced.elapsed() >= Duration::from_millis(100) {
            // UDP has no acknowledgement. Repeating only diffs permanently
            // loses a held press if it was sent before the runtime listened.
            self.send(snapshot(state));
            self.synced = Instant::now();
        } else {
            self.send(changes(self.state, state));
        }
        self.state = state;
    }

    /// Switching players releases everything held as the old player first.
    pub fn set_player(&mut self, player: u8) {
        let player = player.clamp(1, 4);
        if player != self.player {
            self.release();
            self.unplug();
            self.player = player;
        }
    }

    /// Lets go of every button; a pad that was never touched stays unplugged,
    /// so the PC's own controller keeps player 1.
    pub fn release(&mut self) {
        self.apply(PadState::default());
        #[cfg(windows)]
        if self.plugged {
            super::xinput::set(self.player, Some(PadState::default()));
        }
    }

    /// Only the real runtime's relay owns PS3 pads; tests aim at their own port.
    #[cfg(windows)]
    fn has_pads(&self) -> bool {
        self.base_port == REMOTE_PAD_BASE_PORT
    }

    fn unplug(&mut self) {
        #[cfg(windows)]
        if self.plugged {
            super::xinput::set(self.player, None);
            self.plugged = false;
        }
    }
}

fn snapshot(state: PadState) -> Vec<[u8; 20]> {
    let mut packets = Vec::with_capacity(20);
    for id in 0..16 {
        packets.push(message(
            DEVICE_JOYPAD,
            0,
            id,
            u16::from(state.buttons & (1 << id) != 0),
        ));
    }
    for (axis, value) in state.axes.into_iter().enumerate() {
        packets.push(message(
            DEVICE_ANALOG,
            axis as i32 / 2,
            axis as i32 % 2,
            value as u16,
        ));
    }
    packets
}

impl Drop for Relay {
    fn drop(&mut self) {
        self.release();
        self.unplug();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packets_match_the_runtime_layout() {
        let packet = message(DEVICE_JOYPAD, 0, 8, 1);
        assert_eq!(&packet[4..8], &1i32.to_le_bytes());
        assert_eq!(&packet[12..16], &8i32.to_le_bytes());
        assert_eq!(&packet[16..18], &1u16.to_le_bytes());
        assert_eq!(packet.len(), 20);
    }

    #[test]
    fn a_dpad_moves_the_stick_unless_the_stick_is_in_use() {
        let left_up = PadState {
            buttons: UP | LEFT | 1 << 8,
            axes: [0; 4],
        };
        assert_eq!(
            stick_from_dpad(left_up),
            PadState {
                buttons: 1 << 8,
                axes: [-32767, -32767, 0, 0],
            }
        );
        let steering = PadState {
            buttons: RIGHT,
            axes: [12000, 0, 0, 0],
        };
        assert_eq!(stick_from_dpad(steering), steering);
    }

    #[test]
    fn only_changes_are_sent() {
        let held = PadState {
            buttons: 1 << 8 | 1 << 4,
            axes: [0, 0, 0, 0],
        };
        assert_eq!(changes(PadState::default(), held).len(), 2);
        assert!(changes(held, held).is_empty());
        let moved = PadState {
            axes: [-32768, 0, 0, 1200],
            ..held
        };
        let packets = changes(held, moved);
        assert_eq!(packets.len(), 2);
        // Left stick x, then right stick y.
        assert_eq!(&packets[0][4..16], &[5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(&packets[1][8..16], &[1, 0, 0, 0, 1, 0, 0, 0]);
        assert_eq!(&packets[0][16..18], &(-32768i16 as u16).to_le_bytes());
    }

    #[test]
    fn releasing_reaches_the_runtime_port() {
        let listener = UdpSocket::bind("127.0.0.1:0").unwrap();
        listener
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let mut relay = Relay::new().unwrap();
        relay.base_port = listener.local_addr().unwrap().port();
        relay.state = PadState {
            buttons: 1,
            axes: [0; 4],
        };
        relay.release();
        let mut buffer = [0u8; 32];
        assert_eq!(listener.recv(&mut buffer).unwrap(), 20);
        assert_eq!(&buffer[16..18], &0u16.to_le_bytes());
    }

    #[test]
    fn a_held_button_is_recovered_when_the_runtime_starts_late() {
        // The port stays bound throughout: releasing and rebinding it let a
        // parallel test take it in between. Discarding stands in for loss.
        let runtime = UdpSocket::bind("127.0.0.1:0").unwrap();
        runtime
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let mut relay = Relay::new().unwrap();
        relay.base_port = runtime.local_addr().unwrap().port();
        let held = PadState {
            buttons: 1 << 8,
            axes: [1234, 0, 0, 0],
        };
        relay.update(held); // No runtime yet: the initial datagrams are lost.
        for _ in 0..20 {
            runtime.recv(&mut [0; 20]).unwrap();
        }
        relay.synced = Instant::now() - Duration::from_secs(1);
        relay.update(held); // Identical state must still reach a new listener.
        let mut packets = Vec::new();
        for _ in 0..20 {
            let mut packet = [0; 20];
            assert_eq!(runtime.recv(&mut packet).unwrap(), 20);
            packets.push(packet);
        }
        assert_eq!(packets[8], message(DEVICE_JOYPAD, 0, 8, 1));
        assert_eq!(packets[16], message(DEVICE_ANALOG, 0, 0, 1234));
        relay.release();
        let mut packet = [0; 20];
        runtime.recv(&mut packet).unwrap();
        assert_eq!(packet, message(DEVICE_JOYPAD, 0, 8, 0));
    }
}
