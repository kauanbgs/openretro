//! Relays a phone's pad to the runtime's remote gamepad. RetroArch reads one
//! `struct remote_message` per datagram, each changing one button or axis,
//! so transitions are sent immediately and held states are periodically refreshed.
use super::REMOTE_PAD_BASE_PORT;
use std::{
    net::UdpSocket,
    time::{Duration, Instant},
};

const DEVICE_JOYPAD: i32 = 1;
const DEVICE_ANALOG: i32 = 5;

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
}

impl Relay {
    pub fn new() -> std::io::Result<Self> {
        Ok(Self {
            socket: UdpSocket::bind("127.0.0.1:0")?,
            player: 1,
            state: PadState::default(),
            synced: Instant::now() - Duration::from_secs(1),
            base_port: REMOTE_PAD_BASE_PORT,
        })
    }

    fn send(&self, packets: Vec<[u8; 20]>) {
        let target = ("127.0.0.1", self.base_port + u16::from(self.player) - 1);
        for packet in packets {
            // No runtime listening only means no game is running yet.
            let _ = self.socket.send_to(&packet, target);
        }
    }

    pub fn update(&mut self, state: PadState) {
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
            self.player = player;
        }
    }

    pub fn release(&mut self) {
        self.update(PadState::default());
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
        let port = UdpSocket::bind("127.0.0.1:0").unwrap();
        let base = port.local_addr().unwrap().port();
        drop(port);
        let mut relay = Relay::new().unwrap();
        relay.base_port = base;
        let held = PadState {
            buttons: 1 << 8,
            axes: [1234, 0, 0, 0],
        };
        relay.update(held); // No runtime yet: the initial datagrams are lost.
        let runtime = UdpSocket::bind(("127.0.0.1", base)).unwrap();
        runtime
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
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
