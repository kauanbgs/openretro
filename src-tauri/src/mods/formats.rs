//! Patch formats used by translations and ROM hacks: IPS, BPS, UPS and
//! xdelta (VCDIFF). Every applier reads the original and writes a new buffer;
//! nothing here touches files. BPS, UPS and xdelta carry their own checksums,
//! which are verified before a result is returned.
use crate::database::Result;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

/// No supported console has games this large. The bound keeps a damaged
/// patch from asking for gigabytes of memory.
pub const MAX_OUTPUT_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Ips,
    Bps,
    Ups,
    Xdelta,
}
impl Format {
    pub fn parse(name: &str) -> Option<Self> {
        Some(match name.to_ascii_lowercase().as_str() {
            "ips" => Self::Ips,
            "bps" => Self::Bps,
            "ups" => Self::Ups,
            "xdelta" | "xdelta3" | "vcdiff" => Self::Xdelta,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Ips => "IPS",
            Self::Bps => "BPS",
            Self::Ups => "UPS",
            Self::Xdelta => "xdelta",
        }
    }
}
/// Patch files are recognized by content, never by extension alone.
pub fn detect(patch: &[u8]) -> Option<Format> {
    if patch.starts_with(b"PATCH") {
        Some(Format::Ips)
    } else if patch.starts_with(b"BPS1") {
        Some(Format::Bps)
    } else if patch.starts_with(b"UPS1") {
        Some(Format::Ups)
    } else if patch.starts_with(&[0xD6, 0xC3, 0xC4]) {
        Some(Format::Xdelta)
    } else {
        None
    }
}
pub fn is_patch_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        ".ips", ".bps", ".ups", ".xdelta", ".xdelta3", ".vcdiff", ".delta",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

/// What a patch says about the file it expects, read without applying it.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchInfo {
    pub format: Option<Format>,
    pub source_size: Option<u64>,
    pub source_crc32: Option<String>,
    pub target_size: Option<u64>,
    pub target_crc32: Option<String>,
    /// The patch checks the original itself, so a wrong file cannot be patched.
    pub verifies_source: bool,
}
pub fn inspect(patch: &[u8]) -> Result<PatchInfo> {
    let format = detect(patch).ok_or(UNKNOWN)?;
    let mut info = PatchInfo {
        format: Some(format),
        ..Default::default()
    };
    match format {
        Format::Bps | Format::Ups => {
            let footer = footer(patch, format)?;
            let mut at = 4;
            info.source_size = Some(beat_number(patch, &mut at)?);
            info.target_size = Some(beat_number(patch, &mut at)?);
            info.source_crc32 = Some(format!("{:08x}", footer.source));
            info.target_crc32 = Some(format!("{:08x}", footer.target));
            info.verifies_source = true;
        }
        // xdelta stores an Adler-32 of each output window, not of the original.
        Format::Xdelta | Format::Ips => {}
    }
    Ok(info)
}

const UNKNOWN: &str = "Este arquivo não é um patch IPS, BPS, UPS ou xdelta reconhecido.";
const TRUNCATED: &str = "O patch está incompleto ou danificado.";

pub fn apply(patch: &[u8], source: &[u8], cancel: &AtomicBool) -> Result<Vec<u8>> {
    match detect(patch).ok_or(UNKNOWN)? {
        Format::Ips => ips(patch, source, cancel),
        Format::Bps => bps(patch, source, cancel),
        Format::Ups => ups(patch, source, cancel),
        Format::Xdelta => xdelta(patch, source, cancel),
    }
}

fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(CANCELLED.into())
    } else {
        Ok(())
    }
}
pub const CANCELLED: &str = "Instalação cancelada.";

fn bounded(size: u64) -> Result<usize> {
    if size > MAX_OUTPUT_BYTES {
        return Err("O patch gera um arquivo grande demais para ser aplicado.".into());
    }
    usize::try_from(size).map_err(|_| TRUNCATED.into())
}
fn take<'a>(data: &'a [u8], at: &mut usize, count: usize) -> Result<&'a [u8]> {
    let end = at
        .checked_add(count)
        .filter(|end| *end <= data.len())
        .ok_or(TRUNCATED)?;
    let slice = &data[*at..end];
    *at = end;
    Ok(slice)
}

fn ips(patch: &[u8], source: &[u8], cancel: &AtomicBool) -> Result<Vec<u8>> {
    let mut output = source.to_vec();
    let mut at = 5;
    let mut records = 0u32;
    loop {
        let offset = take(patch, &mut at, 3)?;
        if offset == b"EOF" {
            break;
        }
        records += 1;
        if records % 4096 == 0 {
            check_cancel(cancel)?;
        }
        let offset = (offset[0] as usize) << 16 | (offset[1] as usize) << 8 | offset[2] as usize;
        let size = take(patch, &mut at, 2)?;
        let size = (size[0] as usize) << 8 | size[1] as usize;
        let (length, run) = if size == 0 {
            let rle = take(patch, &mut at, 3)?;
            ((rle[0] as usize) << 8 | rle[1] as usize, Some(rle[2]))
        } else {
            (size, None)
        };
        let end = offset + length;
        if end > output.len() {
            output.resize(end, 0);
        }
        match run {
            Some(value) => output[offset..end].fill(value),
            None => output[offset..end].copy_from_slice(take(patch, &mut at, length)?),
        }
    }
    // The common extension: three bytes after EOF truncate the result.
    match patch.len() - at {
        0 => {}
        3 => {
            let size =
                (patch[at] as usize) << 16 | (patch[at + 1] as usize) << 8 | patch[at + 2] as usize;
            output.truncate(size);
        }
        _ => return Err("O patch IPS tem dados depois do fim.".into()),
    }
    Ok(output)
}

/// The variable-length numbers shared by BPS and UPS.
fn beat_number(data: &[u8], at: &mut usize) -> Result<u64> {
    let mut value = 0u64;
    let mut shift = 1u64;
    loop {
        let byte = *data.get(*at).ok_or(TRUNCATED)?;
        *at += 1;
        value = value
            .checked_add(u64::from(byte & 0x7f).checked_mul(shift).ok_or(TRUNCATED)?)
            .ok_or(TRUNCATED)?;
        if byte & 0x80 != 0 {
            return Ok(value);
        }
        shift = shift
            .checked_shl(7)
            .filter(|s| *s < 1 << 56)
            .ok_or(TRUNCATED)?;
        value = value.checked_add(shift).ok_or(TRUNCATED)?;
    }
}
struct Footer {
    source: u32,
    target: u32,
}
fn footer(patch: &[u8], format: Format) -> Result<Footer> {
    if patch.len() < 16 {
        return Err(TRUNCATED.into());
    }
    let word = |at: usize| u32::from_le_bytes(patch[at..at + 4].try_into().unwrap());
    let end = patch.len();
    if crc32fast::hash(&patch[..end - 4]) != word(end - 4) {
        return Err(format!(
            "O patch {} está danificado (checksum do patch não confere).",
            format.name()
        ));
    }
    Ok(Footer {
        source: word(end - 12),
        target: word(end - 8),
    })
}
const WRONG_SOURCE: &str = "Este patch foi feito para outra versão do jogo: o arquivo original não confere com o que o patch exige.";
const WRONG_RESULT: &str =
    "O resultado do patch não confere com o checksum esperado. Nada foi instalado.";

fn bps(patch: &[u8], source: &[u8], cancel: &AtomicBool) -> Result<Vec<u8>> {
    let footer = footer(patch, Format::Bps)?;
    let mut at = 4;
    let source_size = beat_number(patch, &mut at)?;
    let target_size = bounded(beat_number(patch, &mut at)?)?;
    let metadata = usize::try_from(beat_number(patch, &mut at)?).map_err(|_| TRUNCATED)?;
    take(patch, &mut at, metadata)?;
    if source_size != source.len() as u64 || crc32fast::hash(source) != footer.source {
        return Err(WRONG_SOURCE.into());
    }
    let end = patch.len() - 12;
    let mut target = vec![0u8; target_size];
    let (mut output, mut source_relative, mut target_relative) = (0usize, 0i64, 0i64);
    let mut actions = 0u32;
    while at < end {
        actions += 1;
        if actions % 4096 == 0 {
            check_cancel(cancel)?;
        }
        let data = beat_number(patch, &mut at)?;
        let length = usize::try_from((data >> 2) + 1).map_err(|_| TRUNCATED)?;
        let stop = output
            .checked_add(length)
            .filter(|stop| *stop <= target_size)
            .ok_or(TRUNCATED)?;
        match data & 3 {
            0 => target[output..stop].copy_from_slice(source.get(output..stop).ok_or(TRUNCATED)?),
            1 => {
                if at + length > end {
                    return Err(TRUNCATED.into());
                }
                target[output..stop].copy_from_slice(take(patch, &mut at, length)?);
            }
            command => {
                let offset = beat_number(patch, &mut at)?;
                let delta = i64::try_from(offset >> 1).map_err(|_| TRUNCATED)?;
                let delta = if offset & 1 == 1 { -delta } else { delta };
                if command == 2 {
                    source_relative += delta;
                    let from = usize::try_from(source_relative).map_err(|_| TRUNCATED)?;
                    let bytes = source.get(from..from + length).ok_or(TRUNCATED)?;
                    target[output..stop].copy_from_slice(bytes);
                    source_relative += length as i64;
                } else {
                    target_relative += delta;
                    let from = usize::try_from(target_relative).map_err(|_| TRUNCATED)?;
                    if from >= output {
                        return Err(TRUNCATED.into());
                    }
                    // Byte by byte: a target copy may read what it is writing.
                    for index in 0..length {
                        target[output + index] = target[from + index];
                    }
                    target_relative += length as i64;
                }
            }
        }
        output = stop;
    }
    if output != target_size || crc32fast::hash(&target) != footer.target {
        return Err(WRONG_RESULT.into());
    }
    Ok(target)
}

fn ups(patch: &[u8], source: &[u8], cancel: &AtomicBool) -> Result<Vec<u8>> {
    let footer = footer(patch, Format::Ups)?;
    let mut at = 4;
    let source_size = beat_number(patch, &mut at)?;
    let target_size = bounded(beat_number(patch, &mut at)?)?;
    if source_size != source.len() as u64 || crc32fast::hash(source) != footer.source {
        return Err(WRONG_SOURCE.into());
    }
    let mut target = source.to_vec();
    target.resize(target_size, 0);
    let end = patch.len() - 12;
    let mut offset = 0usize;
    let mut hunks = 0u32;
    while at < end {
        hunks += 1;
        if hunks % 4096 == 0 {
            check_cancel(cancel)?;
        }
        let skip = usize::try_from(beat_number(patch, &mut at)?).map_err(|_| TRUNCATED)?;
        offset = offset.checked_add(skip).ok_or(TRUNCATED)?;
        loop {
            if at >= end {
                return Err(TRUNCATED.into());
            }
            let byte = patch[at];
            at += 1;
            if offset < target_size {
                target[offset] ^= byte;
            }
            offset += 1;
            if byte == 0 {
                break;
            }
        }
    }
    if crc32fast::hash(&target) != footer.target {
        return Err(WRONG_RESULT.into());
    }
    Ok(target)
}

/// VCDIFF integers: big-endian groups of seven bits.
fn vc_number(data: &[u8], at: &mut usize) -> Result<u64> {
    let mut value = 0u64;
    for _ in 0..10 {
        let byte = *data.get(*at).ok_or(TRUNCATED)?;
        *at += 1;
        value = value.checked_mul(128).ok_or(TRUNCATED)? | u64::from(byte & 0x7f);
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err(TRUNCATED.into())
}
fn vc_size(data: &[u8], at: &mut usize) -> Result<usize> {
    usize::try_from(vc_number(data, at)?).map_err(|_| TRUNCATED.into())
}

#[derive(Clone, Copy, Default)]
struct Instruction {
    kind: u8, // 0 noop, 1 add, 2 run, 3 copy
    size: u8,
    mode: u8,
}
/// RFC 3284 section 5.6, the table every xdelta patch without a custom one uses.
fn default_code_table() -> [[Instruction; 2]; 256] {
    let mut table = [[Instruction::default(); 2]; 256];
    let single = |kind, size, mode| [Instruction { kind, size, mode }, Instruction::default()];
    let mut index = 0;
    table[index] = single(2, 0, 0);
    index += 1;
    for size in 0..=17 {
        table[index] = single(1, size, 0);
        index += 1;
    }
    for mode in 0..9 {
        table[index] = single(3, 0, mode);
        index += 1;
        for size in 4..=18 {
            table[index] = single(3, size, mode);
            index += 1;
        }
    }
    for mode in 0..9u8 {
        let copies: &[u8] = if mode < 6 { &[4, 5, 6] } else { &[4] };
        for add in 1..=4 {
            for copy in copies {
                table[index] = [
                    Instruction {
                        kind: 1,
                        size: add,
                        mode: 0,
                    },
                    Instruction {
                        kind: 3,
                        size: *copy,
                        mode,
                    },
                ];
                index += 1;
            }
        }
    }
    for mode in 0..9 {
        table[index] = [
            Instruction {
                kind: 3,
                size: 4,
                mode,
            },
            Instruction {
                kind: 1,
                size: 1,
                mode: 0,
            },
        ];
        index += 1;
    }
    debug_assert_eq!(index, 256);
    table
}
struct AddressCache {
    near: [u64; 4],
    next: usize,
    same: [u64; 768],
}
impl AddressCache {
    fn new() -> Self {
        Self {
            near: [0; 4],
            next: 0,
            same: [0; 768],
        }
    }
    fn decode(&mut self, here: u64, mode: u8, addresses: &[u8], at: &mut usize) -> Result<u64> {
        let address = match mode {
            0 => vc_number(addresses, at)?,
            1 => here
                .checked_sub(vc_number(addresses, at)?)
                .ok_or(TRUNCATED)?,
            2..=5 => self.near[(mode - 2) as usize]
                .checked_add(vc_number(addresses, at)?)
                .ok_or(TRUNCATED)?,
            6..=8 => {
                let byte = *addresses.get(*at).ok_or(TRUNCATED)?;
                *at += 1;
                self.same[(mode as usize - 6) * 256 + byte as usize]
            }
            _ => return Err(TRUNCATED.into()),
        };
        if address >= here {
            return Err(TRUNCATED.into());
        }
        self.near[self.next] = address;
        self.next = (self.next + 1) % 4;
        self.same[(address % 768) as usize] = address;
        Ok(address)
    }
}
fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for chunk in data.chunks(5552) {
        for byte in chunk {
            a += u32::from(*byte);
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    b << 16 | a
}

fn xdelta(patch: &[u8], source: &[u8], cancel: &AtomicBool) -> Result<Vec<u8>> {
    if patch.len() < 5 || patch[3] != 0 {
        return Err("Versão de VCDIFF não suportada.".into());
    }
    let header = patch[4];
    let mut at = 5;
    if header & 0x01 != 0 {
        return Err("Este patch xdelta usa compressão secundária, que o OpenRetro ainda não aplica. Recrie o patch sem compressão secundária (xdelta3 -S none) ou aplique-o com outra ferramenta e importe o jogo resultante.".into());
    }
    if header & 0x02 != 0 {
        return Err(
            "Este patch xdelta usa uma tabela de códigos própria, que não é suportada.".into(),
        );
    }
    if header & 0x04 != 0 {
        let length = vc_size(patch, &mut at)?;
        take(patch, &mut at, length)?;
    }
    if header & !0x07 != 0 {
        return Err(TRUNCATED.into());
    }
    let table = default_code_table();
    let mut target: Vec<u8> = Vec::new();
    while at < patch.len() {
        check_cancel(cancel)?;
        let indicator = patch[at];
        at += 1;
        if indicator & !0x07 != 0 || indicator & 0x03 == 0x03 {
            return Err(TRUNCATED.into());
        }
        let segment = if indicator & 0x03 != 0 {
            let length = vc_size(patch, &mut at)?;
            let position = vc_size(patch, &mut at)?;
            let base: &[u8] = if indicator & 0x01 != 0 {
                source
            } else {
                &target
            };
            let end = position
                .checked_add(length)
                .filter(|end| *end <= base.len());
            let end = end.ok_or(WRONG_SOURCE)?;
            base[position..end].to_vec()
        } else {
            Vec::new()
        };
        let encoding_length = vc_size(patch, &mut at)?;
        let encoding_end = at
            .checked_add(encoding_length)
            .filter(|end| *end <= patch.len())
            .ok_or(TRUNCATED)?;
        let window_size = vc_size(patch, &mut at)?;
        if target.len() as u64 + window_size as u64 > MAX_OUTPUT_BYTES {
            return Err("O patch gera um arquivo grande demais para ser aplicado.".into());
        }
        let delta = *patch.get(at).ok_or(TRUNCATED)?;
        at += 1;
        if delta != 0 {
            return Err(
                "Este patch xdelta usa compressão secundária, que o OpenRetro ainda não aplica."
                    .into(),
            );
        }
        let data_length = vc_size(patch, &mut at)?;
        let instructions_length = vc_size(patch, &mut at)?;
        let addresses_length = vc_size(patch, &mut at)?;
        let checksum = if indicator & 0x04 != 0 {
            Some(u32::from_be_bytes(
                take(patch, &mut at, 4)?.try_into().unwrap(),
            ))
        } else {
            None
        };
        let data = take(patch, &mut at, data_length)?;
        let instructions = take(patch, &mut at, instructions_length)?;
        let addresses = take(patch, &mut at, addresses_length)?;
        if at != encoding_end {
            return Err(TRUNCATED.into());
        }
        let mut window: Vec<u8> = Vec::with_capacity(window_size);
        let mut cache = AddressCache::new();
        let (mut data_at, mut instruction_at, mut address_at) = (0usize, 0usize, 0usize);
        while instruction_at < instructions.len() {
            let pair = table[instructions[instruction_at] as usize];
            instruction_at += 1;
            for instruction in pair {
                if instruction.kind == 0 {
                    continue;
                }
                let size = if instruction.size == 0 {
                    vc_size(instructions, &mut instruction_at)?
                } else {
                    instruction.size as usize
                };
                if window.len() + size > window_size {
                    return Err(TRUNCATED.into());
                }
                match instruction.kind {
                    1 => window.extend_from_slice(take(data, &mut data_at, size)?),
                    2 => {
                        let value = take(data, &mut data_at, 1)?[0];
                        window.resize(window.len() + size, value);
                    }
                    _ => {
                        let here = (segment.len() + window.len()) as u64;
                        let address =
                            cache.decode(here, instruction.mode, addresses, &mut address_at)?
                                as usize;
                        for index in 0..size {
                            let position = address + index;
                            let byte = if position < segment.len() {
                                segment[position]
                            } else {
                                *window.get(position - segment.len()).ok_or(TRUNCATED)?
                            };
                            window.push(byte);
                        }
                    }
                }
            }
        }
        if window.len() != window_size || data_at != data.len() || address_at != addresses.len() {
            return Err(TRUNCATED.into());
        }
        if checksum.is_some_and(|expected| adler32(&window) != expected) {
            return Err(WRONG_SOURCE.into());
        }
        target.extend_from_slice(&window);
    }
    Ok(target)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    fn never() -> AtomicBool {
        AtomicBool::new(false)
    }
    fn beat(mut value: u64, out: &mut Vec<u8>) {
        loop {
            let x = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                out.push(0x80 | x);
                return;
            }
            out.push(x);
            value -= 1;
        }
    }
    fn seal(mut patch: Vec<u8>, source: &[u8], target: &[u8]) -> Vec<u8> {
        patch.extend(crc32fast::hash(source).to_le_bytes());
        patch.extend(crc32fast::hash(target).to_le_bytes());
        let crc = crc32fast::hash(&patch);
        patch.extend(crc.to_le_bytes());
        patch
    }
    /// A small test ROM with some structure, so copies have something to find.
    pub fn sample_rom(size: usize) -> Vec<u8> {
        (0..size).map(|i| ((i * 7) ^ (i >> 5)) as u8).collect()
    }
    pub fn ips_patch(records: &[(usize, &[u8])]) -> Vec<u8> {
        let mut patch = b"PATCH".to_vec();
        for (offset, bytes) in records {
            patch.extend(&(*offset as u32).to_be_bytes()[1..]);
            patch.extend((bytes.len() as u16).to_be_bytes());
            patch.extend(*bytes);
        }
        patch.extend(b"EOF");
        patch
    }
    /// BPS using every action: source read, target read, source copy and an
    /// overlapping target copy.
    pub fn bps_patch(source: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let mut target = source[..16].to_vec();
        target.extend(b"NEW!");
        target.extend(&source[100..140]);
        let repeat = target[target.len() - 2..].to_vec();
        for i in 0..10 {
            target.push(repeat[i % 2]);
        }
        let mut patch = b"BPS1".to_vec();
        beat(source.len() as u64, &mut patch);
        beat(target.len() as u64, &mut patch);
        beat(3, &mut patch);
        patch.extend(b"<x>");
        beat((16 - 1) << 2, &mut patch);
        beat(((4 - 1) << 2) | 1, &mut patch);
        patch.extend(b"NEW!");
        beat(((40 - 1) << 2) | 2, &mut patch);
        beat(100 << 1, &mut patch);
        beat(((10 - 1) << 2) | 3, &mut patch);
        beat(((target.len() - 12) as u64) << 1, &mut patch);
        (seal(patch, source, &target), target)
    }
    pub fn ups_patch(source: &[u8], target: &[u8]) -> Vec<u8> {
        let mut patch = b"UPS1".to_vec();
        beat(source.len() as u64, &mut patch);
        beat(target.len() as u64, &mut patch);
        let length = source.len().max(target.len());
        let byte = |data: &[u8], i: usize| data.get(i).copied().unwrap_or(0);
        let mut last = 0;
        let mut i = 0;
        while i < length {
            if byte(source, i) == byte(target, i) {
                i += 1;
                continue;
            }
            beat((i - last) as u64, &mut patch);
            while i < length && byte(source, i) != byte(target, i) {
                patch.push(byte(source, i) ^ byte(target, i));
                i += 1;
            }
            patch.push(0);
            i += 1;
            last = i;
        }
        seal(patch, source, target)
    }
    fn vc(mut value: u64, out: &mut Vec<u8>) {
        let mut bytes = vec![(value & 0x7f) as u8];
        value >>= 7;
        while value > 0 {
            bytes.push(0x80 | (value & 0x7f) as u8);
            value >>= 7;
        }
        bytes.reverse();
        out.extend(bytes);
    }
    /// One VCDIFF window over the whole source: copy, add, run, then a copy
    /// from the target written so far, with xdelta's Adler-32 checksum.
    pub fn xdelta_patch(source: &[u8], checksum: bool) -> (Vec<u8>, Vec<u8>) {
        let mut target = source[8..40].to_vec();
        target.extend(b"PT-BR");
        target.extend([0xAA; 6]);
        target.extend(&source[8..12]);
        let (mut data, mut instructions, mut addresses) = (Vec::new(), Vec::new(), Vec::new());
        // COPY mode 0, explicit size.
        instructions.push(19);
        vc(32, &mut instructions);
        vc(8, &mut addresses);
        // ADD size 5 is code 6.
        instructions.push(6);
        data.extend(b"PT-BR");
        // RUN with explicit size.
        instructions.push(0);
        vc(6, &mut instructions);
        data.push(0xAA);
        // COPY size 4 mode 1 (VCD_HERE): back to the first bytes written.
        instructions.push(19 + 16 + 1);
        let here = source.len() + 43;
        vc((here - source.len()) as u64, &mut addresses);
        let mut window = Vec::new();
        vc(source.len() as u64, &mut window);
        vc(0, &mut window);
        let mut body = Vec::new();
        vc(target.len() as u64, &mut body);
        body.push(0);
        vc(data.len() as u64, &mut body);
        vc(instructions.len() as u64, &mut body);
        vc(addresses.len() as u64, &mut body);
        if checksum {
            body.extend(adler32(&target).to_be_bytes());
        }
        body.extend(&data);
        body.extend(&instructions);
        body.extend(&addresses);
        let mut patch = vec![0xD6, 0xC3, 0xC4, 0, 0x04];
        vc(3, &mut patch);
        patch.extend(b"app");
        patch.push(if checksum { 0x05 } else { 0x01 });
        patch.extend(window);
        vc(body.len() as u64, &mut patch);
        patch.extend(body);
        (patch, target)
    }

    #[test]
    fn ips_writes_records_runs_growth_and_truncation() {
        let source = sample_rom(64);
        let mut patch = ips_patch(&[(4, b"abc"), (70, b"Z")]);
        // An RLE record: offset 10, size 0, run of 5 x 0xEE.
        patch.splice(
            patch.len() - 3..patch.len() - 3,
            [0, 0, 10, 0, 0, 0, 5, 0xEE],
        );
        let output = apply(&patch, &source, &never()).unwrap();
        assert_eq!(&output[4..7], b"abc");
        assert_eq!(&output[10..15], &[0xEE; 5]);
        assert_eq!(output.len(), 71);
        assert_eq!(output[64..70], [0; 6]);
        assert_eq!(output[0..4], source[0..4]);
        patch.extend([0, 0, 32]);
        assert_eq!(apply(&patch, &source, &never()).unwrap().len(), 32);
        patch.push(1);
        assert!(apply(&patch, &source, &never()).is_err());
        assert!(apply(&b"PATCH\0\0\x04\0\x09abc"[..], &source, &never()).is_err());
    }

    #[test]
    fn bps_applies_every_action_and_checks_both_sides() {
        let source = sample_rom(4096);
        let (patch, target) = bps_patch(&source);
        assert_eq!(apply(&patch, &source, &never()).unwrap(), target);
        let info = inspect(&patch).unwrap();
        assert_eq!(info.source_size, Some(4096));
        assert_eq!(
            info.source_crc32,
            Some(format!("{:08x}", crc32fast::hash(&source)))
        );
        assert!(info.verifies_source);
        let mut other = source.clone();
        other[3] ^= 1;
        assert_eq!(apply(&patch, &other, &never()).unwrap_err(), WRONG_SOURCE);
        let mut damaged = patch.clone();
        damaged[20] ^= 0x40;
        assert!(apply(&damaged, &source, &never())
            .unwrap_err()
            .contains("danificado"));
    }

    #[test]
    fn ups_applies_growth_and_rejects_another_original() {
        let source = sample_rom(300);
        let mut target = source.clone();
        target[5] = 1;
        target[6] = 2;
        target[200] ^= 0xff;
        target.extend(b"extra");
        let patch = ups_patch(&source, &target);
        assert_eq!(apply(&patch, &source, &never()).unwrap(), target);
        assert_eq!(
            apply(&patch, &source[..299], &never()).unwrap_err(),
            WRONG_SOURCE
        );
    }

    #[test]
    fn xdelta_decodes_copy_add_run_and_checks_adler() {
        let source = sample_rom(512);
        for checksum in [true, false] {
            let (patch, target) = xdelta_patch(&source, checksum);
            assert_eq!(
                apply(&patch, &source, &never()).unwrap(),
                target,
                "{checksum}"
            );
        }
        let (patch, _) = xdelta_patch(&source, true);
        let mut other = source.clone();
        other[20] ^= 1;
        assert_eq!(apply(&patch, &other, &never()).unwrap_err(), WRONG_SOURCE);
        let mut secondary = patch.clone();
        secondary[4] |= 0x01;
        assert!(apply(&secondary, &source, &never())
            .unwrap_err()
            .contains("compressão secundária"));
        assert_eq!(adler32(b"Wikipedia"), 0x11E60398);
    }

    #[test]
    fn default_code_table_matches_the_rfc() {
        let table = default_code_table();
        assert_eq!((table[0][0].kind, table[0][0].size), (2, 0));
        assert_eq!((table[18][0].kind, table[18][0].size), (1, 17));
        assert_eq!((table[19][0].kind, table[19][0].mode), (3, 0));
        assert_eq!((table[162][0].size, table[162][0].mode), (18, 8));
        assert_eq!(
            (table[163][0].size, table[163][1].size, table[163][1].mode),
            (1, 4, 0)
        );
        assert_eq!((table[246][0].size, table[246][1].mode), (4, 8));
        assert_eq!(
            (table[255][0].kind, table[255][0].mode, table[255][1].kind),
            (3, 8, 1)
        );
    }

    #[test]
    fn damaged_and_unknown_patches_fail_without_panicking() {
        let source = sample_rom(4096);
        let (bps, _) = bps_patch(&source);
        let (xdelta, _) = xdelta_patch(&source, true);
        let ups = ups_patch(&source, &sample_rom(10));
        for patch in [bps, xdelta, ups, ips_patch(&[(1, b"x")])] {
            for cut in [5, patch.len() / 2, patch.len() - 1] {
                assert!(apply(&patch[..cut], &source, &never()).is_err());
            }
        }
        assert_eq!(apply(b"MZ\x90\0", &source, &never()).unwrap_err(), UNKNOWN);
    }

    #[test]
    fn cancelling_stops_a_long_patch() {
        let source = sample_rom(1 << 16);
        let records: Vec<(usize, Vec<u8>)> = (0..10_000).map(|i| (i * 4, vec![1])).collect();
        let records: Vec<(usize, &[u8])> =
            records.iter().map(|(o, b)| (*o, b.as_slice())).collect();
        let patch = ips_patch(&records);
        assert_eq!(
            apply(&patch, &source, &AtomicBool::new(true)).unwrap_err(),
            CANCELLED
        );
    }
}
