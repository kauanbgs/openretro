//! Reads one patch out of whatever the author published: the patch itself,
//! or a ZIP or 7z with it inside. Only the patch is read, into memory; no
//! other file from a package is written to disk, and nothing is ever run.
use super::formats;
use crate::database::{error, Result};
use std::{
    fs::File,
    io::Read,
    path::{Component, Path},
};

pub const MAX_PATCH_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;
const MAX_CHOICES: usize = 200;

#[derive(Debug)]
pub enum Loaded {
    Patch {
        name: String,
        bytes: Vec<u8>,
    },
    /// The package has several patches and none was named.
    Choose(Vec<String>),
}

fn too_large() -> String {
    "O patch é maior que o limite de 256 MB.".into()
}
fn read_limited(reader: impl Read, declared: u64) -> Result<Vec<u8>> {
    if declared > MAX_PATCH_BYTES {
        return Err(too_large());
    }
    let mut bytes = Vec::with_capacity(declared as usize);
    // A package can understate sizes; never read past the limit regardless.
    reader
        .take(MAX_PATCH_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "O pacote está danificado e o patch não pôde ser lido.".to_string())?;
    if bytes.len() as u64 > MAX_PATCH_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}
/// Names inside packages, with `/` separators and no way out of the package.
fn clean_name(name: &str) -> Result<String> {
    let name = name.replace('\\', "/");
    let path = Path::new(&name);
    if name.contains('\0')
        || path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("O pacote contém um caminho inseguro e foi recusado.".into());
    }
    Ok(name.trim_start_matches("./").to_string())
}
fn choose(
    mut candidates: Vec<String>,
    wanted: Option<&str>,
) -> Result<std::result::Result<String, Vec<String>>> {
    candidates.sort();
    if let Some(wanted) = wanted {
        let wanted = clean_name(wanted)?;
        return candidates
            .into_iter()
            .find(|name| *name == wanted)
            .map(Ok)
            .ok_or_else(|| format!("O pacote não contém o patch {wanted}. O autor pode ter publicado outra versão."));
    }
    match candidates.len() {
        0 => Err("Nenhum patch IPS, BPS, UPS ou xdelta foi encontrado no pacote.".into()),
        1 => Ok(Ok(candidates.remove(0))),
        _ => {
            candidates.truncate(MAX_CHOICES);
            Ok(Err(candidates))
        }
    }
}

pub fn load(path: &Path, wanted: Option<&str>) -> Result<Loaded> {
    let mut magic = [0u8; 6];
    let read = File::open(path)
        .and_then(|mut f| f.read(&mut magic))
        .map_err(error)?;
    let magic = &magic[..read];
    if magic.starts_with(b"PK\x03\x04") || magic.starts_with(b"PK\x05\x06") {
        zip(path, wanted)
    } else if magic.starts_with(&[b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C]) {
        seven_zip(path, wanted)
    } else if magic.starts_with(b"Rar!") {
        Err("Pacotes RAR não são suportados. Extraia o patch e importe o arquivo .ips, .bps, .ups ou .xdelta.".into())
    } else {
        let size = std::fs::metadata(path).map_err(error)?.len();
        let bytes = read_limited(File::open(path).map_err(error)?, size)?;
        if formats::detect(&bytes).is_none() {
            return Err("Este arquivo não é um patch IPS, BPS, UPS ou xdelta, nem um ZIP ou 7z com um deles.".into());
        }
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        Ok(Loaded::Patch { name, bytes })
    }
}

fn zip(path: &Path, wanted: Option<&str>) -> Result<Loaded> {
    let mut archive = zip::ZipArchive::new(File::open(path).map_err(error)?)
        .map_err(|_| "O ZIP está danificado.".to_string())?;
    if archive.len() > MAX_ENTRIES {
        return Err("O ZIP tem arquivos demais.".into());
    }
    let mut candidates = Vec::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|_| "O ZIP está danificado.".to_string())?;
        let name = clean_name(entry.name())?;
        if entry.is_file() && formats::is_patch_name(&name) {
            candidates.push(name);
        }
    }
    let name = match choose(candidates, wanted)? {
        Ok(name) => name,
        Err(choices) => return Ok(Loaded::Choose(choices)),
    };
    let index = (0..archive.len())
        .find(|i| {
            archive
                .by_index_raw(*i)
                .is_ok_and(|e| clean_name(e.name()).ok().as_deref() == Some(&name))
        })
        .ok_or("O patch sumiu do ZIP durante a leitura.")?;
    let entry = archive
        .by_index(index)
        .map_err(|e| format!("O patch dentro do ZIP não pôde ser lido ({e})."))?;
    let declared = entry.size();
    // The ZIP reader checks the CRC as the entry ends, so damage is an error here.
    let bytes = read_limited(entry, declared)?;
    Ok(Loaded::Patch { name, bytes })
}

fn seven_zip(path: &Path, wanted: Option<&str>) -> Result<Loaded> {
    let mut reader = sevenz_rust2::ArchiveReader::open(path, sevenz_rust2::Password::empty())
        .map_err(|_| "O 7z está danificado ou protegido por senha.".to_string())?;
    let files = &reader.archive().files;
    if files.len() > MAX_ENTRIES {
        return Err("O 7z tem arquivos demais.".into());
    }
    let mut candidates = Vec::new();
    let mut sizes = std::collections::HashMap::new();
    for entry in files {
        let name = clean_name(entry.name())?;
        if !entry.is_directory() && entry.has_stream && formats::is_patch_name(&name) {
            sizes.insert(name.clone(), (entry.name().to_string(), entry.size()));
            candidates.push(name);
        }
    }
    let name = match choose(candidates, wanted)? {
        Ok(name) => name,
        Err(choices) => return Ok(Loaded::Choose(choices)),
    };
    let (original, size) = sizes
        .remove(&name)
        .ok_or("O patch sumiu do 7z durante a leitura.")?;
    if size > MAX_PATCH_BYTES {
        return Err(too_large());
    }
    let bytes = reader
        .read_file(&original)
        .map_err(|_| "O patch dentro do 7z não pôde ser lido.".to_string())?;
    if bytes.len() as u64 > MAX_PATCH_BYTES {
        return Err(too_large());
    }
    Ok(Loaded::Patch { name, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("openretro-archive-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }
    fn zip_with(path: &Path, files: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
        for (name, data) in files {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn reads_the_named_patch_and_ignores_executables() {
        let path = temp("pack.zip");
        let patch = formats::tests::ips_patch(&[(0, b"x")]);
        zip_with(
            &path,
            &[
                ("ReadMe.md", b"readme"),
                ("bin/flips.exe", b"MZ\x90\0"),
                ("install.bat", b"del *"),
                ("Hack.ips", &patch),
                ("optional/Extra.ips", &patch),
            ],
        );
        match load(&path, Some("Hack.ips")).unwrap() {
            Loaded::Patch { name, bytes } => {
                assert_eq!((name.as_str(), bytes), ("Hack.ips", patch))
            }
            Loaded::Choose(_) => panic!("named patch"),
        }
        match load(&path, None).unwrap() {
            Loaded::Choose(choices) => assert_eq!(choices, ["Hack.ips", "optional/Extra.ips"]),
            Loaded::Patch { .. } => panic!("two patches need a choice"),
        }
        assert!(load(&path, Some("bin/flips.exe")).is_err());
        assert!(load(&path, Some("../Hack.ips")).is_err());
        // Nothing besides the package itself was written.
        assert_eq!(
            std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1
        );
    }

    #[test]
    fn rejects_unsafe_paths_damage_and_other_files() {
        let path = temp("evil.zip");
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("../../escape.ips", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"PATCHEOF").unwrap();
        zip.finish().unwrap();
        assert!(load(&path, None).unwrap_err().contains("inseguro"));
        let exe = temp("setup.exe");
        std::fs::write(&exe, b"MZ\x90\0\x03").unwrap();
        assert!(load(&exe, None).is_err());
        let damaged = temp("damaged.zip");
        let mut zip = zip::ZipWriter::new(File::create(&damaged).unwrap());
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("Hack.ips", stored).unwrap();
        zip.write_all(&formats::tests::sample_rom(4000)).unwrap();
        zip.finish().unwrap();
        let mut bytes = std::fs::read(&damaged).unwrap();
        // Inside the stored data, after the 30-byte header and the name.
        bytes[30 + "Hack.ips".len() + 100] ^= 0xff;
        std::fs::write(&damaged, bytes).unwrap();
        assert!(load(&damaged, None).is_err());
        let rar = temp("x.rar");
        std::fs::write(&rar, b"Rar!\x1a\x07").unwrap();
        assert!(load(&rar, None).unwrap_err().contains("RAR"));
    }

    #[test]
    fn reads_a_patch_from_7z() {
        let source = temp("src");
        std::fs::create_dir_all(&source).unwrap();
        let (patch, _) = formats::tests::bps_patch(&formats::tests::sample_rom(4096));
        std::fs::write(source.join("Translation.bps"), &patch).unwrap();
        std::fs::write(source.join("leia-me.txt"), b"creditos").unwrap();
        let archive = source.with_file_name("pack.7z");
        sevenz_rust2::compress_to_path(&source, &archive).unwrap();
        match load(&archive, None).unwrap() {
            Loaded::Patch { name, bytes } => {
                assert!(name.ends_with("Translation.bps"));
                assert_eq!(bytes, patch);
            }
            Loaded::Choose(_) => panic!("one patch"),
        }
    }
}
