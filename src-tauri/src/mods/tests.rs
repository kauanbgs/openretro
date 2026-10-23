use super::*;
use formats::tests::{bps_patch, ips_patch, sample_rom, ups_patch, xdelta_patch};

struct Fixture {
    root: PathBuf,
    db: Database,
    rom: PathBuf,
    rom_bytes: Vec<u8>,
    item_id: String,
}
impl Fixture {
    fn new(platform: &str, file: &str, rom_bytes: Vec<u8>) -> Self {
        let root = std::env::temp_dir().join(format!("openretro-mods-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("roms")).unwrap();
        let rom = root.join("roms").join(file);
        std::fs::write(&rom, &rom_bytes).unwrap();
        let db = crate::database::initialize(&root.join("db.sqlite")).unwrap();
        let item_id = uuid::Uuid::new_v4().to_string();
        {
            let conn = db.0.lock().unwrap();
            let game = serde_json::json!({"id": "g1", "title": "Test Game", "platformId": platform, "year": 1994, "developer": "", "description": "", "genre": "", "artwork": "", "color": ""});
            conn.execute(
                "INSERT INTO games(id,metadata) VALUES('g1',?1)",
                [game.to_string()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO library_items(id,game_id,platform_id,source_provider,source_path,added_at,sha256) VALUES(?1,'g1',?2,'local',?3,?4,?5)",
                params![item_id, platform, rom.to_string_lossy(), chrono::Utc::now().to_rfc3339(), sha256_hex(&rom_bytes)],
            )
            .unwrap();
        }
        Fixture {
            root,
            db,
            rom,
            rom_bytes,
            item_id,
        }
    }
    fn data(&self) -> PathBuf {
        self.root.join("mods")
    }
    fn item(&self) -> Item {
        let platform: String = self
            .db
            .0
            .lock()
            .unwrap()
            .query_row(
                "SELECT platform_id FROM library_items WHERE id=?1",
                [&self.item_id],
                |r| r.get(0),
            )
            .unwrap();
        Item {
            id: self.item_id.clone(),
            title: "Test Game".into(),
            platform_id: platform,
            path: self.rom.to_string_lossy().into_owned(),
            sha256: sha256_hex(&self.rom_bytes),
        }
    }
    fn plan(&self, entry: Option<Entry>, parent: Option<Variant>) -> Plan {
        let item = self.item();
        let (base_path, base_sha256) = match &parent {
            Some(p) => (PathBuf::from(&p.path), p.sha256.clone()),
            None => (self.rom.clone(), item.sha256.clone()),
        };
        let print = fingerprint_file(&base_path, &item.platform_id).unwrap();
        let bases = entry
            .as_ref()
            .map(|e| vec![e.base.clone()])
            .unwrap_or_default();
        let compatibility = match &entry {
            Some(e) => best(&e.game, &bases, &print),
            None => Compatibility {
                status: Status::Unknown,
                reason: String::new(),
                strip_header: false,
            },
        };
        Plan {
            item,
            parent,
            base_path,
            base_sha256,
            entry,
            source_name: "Teste".into(),
            compatibility,
        }
    }
    fn package(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let directory = self.root.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }
    fn zip(&self, files: &[(&str, &[u8])]) -> PathBuf {
        let path = self.root.join(format!("{}.zip", uuid::Uuid::new_v4()));
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (name, data) in files {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
        path
    }
    fn store(
        &self,
        request: &InstallRequest,
        plan: &Plan,
        package: &Path,
        stop: bool,
    ) -> Result<Stored> {
        let mut steps = Vec::new();
        let result = store_variant(
            &self.db,
            &self.data(),
            request,
            plan,
            package,
            &AtomicBool::new(stop),
            &mut |state: &str, stage: &str, _| steps.push(format!("{state}:{stage}")),
        );
        result
    }
    fn variant_rows(&self) -> i64 {
        self.db
            .0
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM game_variants", [], |r| r.get(0))
            .unwrap()
    }
    fn leftover_files(&self) -> usize {
        std::fs::read_dir(self.data().join("variants"))
            .map(|d| d.count())
            .unwrap_or(0)
    }
    fn original_untouched(&self) {
        assert_eq!(
            std::fs::read(&self.rom).unwrap(),
            self.rom_bytes,
            "the original must never change"
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn request(fixture: &Fixture, origin: &str) -> InstallRequest {
    InstallRequest {
        library_item_id: fixture.item_id.clone(),
        origin: origin.into(),
        ..Default::default()
    }
}
fn catalog_entry(base_sha256: &str, format: &str) -> Entry {
    let mut entry = catalog::tests::entry();
    entry.base = Hashes {
        sha256: Some(base_sha256.into()),
        ..Default::default()
    };
    entry.patch.format = format.into();
    entry.patch.path = Some("Hack.".to_string() + format);
    entry
}
fn stored(result: Result<Stored>) -> Variant {
    match result.unwrap() {
        Stored::Variant(variant) => variant,
        Stored::Choose(choices) => panic!("asked to choose: {choices:?}"),
    }
}

#[test]
fn installs_a_catalog_bps_from_a_zip_as_a_copy() {
    let fixture = Fixture::new("snes", "Test Game (USA).sfc", sample_rom(8192));
    let (patch, target) = bps_patch(&fixture.rom_bytes);
    let mut entry = catalog_entry(&sha256_hex(&fixture.rom_bytes), "bps");
    entry.result = Some(Hashes {
        sha256: Some(sha256_hex(&target)),
        ..Default::default()
    });
    entry.patch.file_sha256 = Some(sha256_hex(&patch));
    let package = fixture.zip(&[
        ("ReadMe.txt", b"credits"),
        ("tools/flips.exe", b"MZ\x90\0"),
        ("Hack.bps", &patch),
        ("Other.bps", &patch),
    ]);
    let plan = fixture.plan(Some(entry), None);
    assert_eq!(plan.compatibility.status, Status::Confirmed);
    let variant = stored(fixture.store(&request(&fixture, "catalog"), &plan, &package, false));
    fixture.original_untouched();
    assert_eq!(std::fs::read(&variant.path).unwrap(), target);
    assert_eq!(variant.sha256, sha256_hex(&target));
    assert_eq!(
        Path::new(&variant.path).file_name().unwrap(),
        "Test Game (USA).sfc"
    );
    assert!(Path::new(&variant.path).starts_with(fixture.data().join("variants")));
    assert_eq!(variant.saves, "separate");
    assert_eq!(variant.authors, ["Autor"]);
    assert_eq!(variant.format, "BPS");
    assert_eq!(fixture.variant_rows(), 1);
    // Only the patch was read from the package; the tool inside never reached the disk.
    let files: Vec<_> = std::fs::read_dir(Path::new(&variant.path).parent().unwrap())
        .unwrap()
        .flatten()
        .collect();
    assert_eq!(files.len(), 1);
    // The same result again is the same version, not a second copy.
    let again = fixture.store(&request(&fixture, "catalog"), &plan, &package, false);
    assert!(again.err().unwrap().contains("já está instalada"));
    assert_eq!(fixture.leftover_files(), 1);
}

#[test]
fn every_format_installs_from_a_local_file() {
    let rom = sample_rom(4096);
    let mut grown = rom.clone();
    grown[10] ^= 0x55;
    grown.extend(b"tail");
    let (bps, bps_target) = bps_patch(&rom);
    let (xdelta, xdelta_target) = xdelta_patch(&rom, true);
    let mut ips_target = rom.clone();
    ips_target[100..103].copy_from_slice(b"abc");
    let cases: [(&str, Vec<u8>, Vec<u8>, bool); 4] = [
        ("hack.ips", ips_patch(&[(100, b"abc")]), ips_target, false),
        ("hack.bps", bps, bps_target, true),
        ("hack.ups", ups_patch(&rom, &grown), grown, true),
        ("hack.xdelta", xdelta, xdelta_target, false),
    ];
    for (name, patch, target, verifies) in cases {
        let fixture = Fixture::new("gba", "Jogo.gba", rom.clone());
        let package = fixture.package(name, &patch);
        let mut local = request(&fixture, "local");
        // IPS and xdelta cannot confirm the original up front.
        let refused = fixture.store(&local, &fixture.plan(None, None), &package, false);
        if verifies {
            let variant = stored(refused);
            assert_eq!(variant.compatibility, Status::Confirmed, "{name}");
            assert_eq!(std::fs::read(&variant.path).unwrap(), target, "{name}");
            continue;
        }
        assert!(refused.err().unwrap().contains("desconhecida"), "{name}");
        assert_eq!(fixture.variant_rows(), 0);
        local.confirm_unknown = true;
        let variant = stored(fixture.store(&local, &fixture.plan(None, None), &package, false));
        assert_eq!(std::fs::read(&variant.path).unwrap(), target, "{name}");
        assert_eq!(variant.kind, "local");
        assert_eq!(variant.name, "hack");
        fixture.original_untouched();
    }
}

#[test]
fn a_patch_for_another_version_is_refused_before_writing() {
    let fixture = Fixture::new("gba", "Jogo.gba", sample_rom(4096));
    let (patch, _) = bps_patch(&sample_rom(4000));
    let package = fixture.package("other.bps", &patch);
    let error = fixture
        .store(
            &request(&fixture, "local"),
            &fixture.plan(None, None),
            &package,
            false,
        )
        .err()
        .unwrap();
    assert!(error.contains("outra versão"), "{error}");
    let (xdelta, _) = xdelta_patch(
        &sample_rom(4096).iter().map(|b| b ^ 1).collect::<Vec<_>>(),
        true,
    );
    let mut confirmed = request(&fixture, "local");
    confirmed.confirm_unknown = true;
    let error = fixture
        .store(
            &confirmed,
            &fixture.plan(None, None),
            &fixture.package("other.xdelta", &xdelta),
            false,
        )
        .err()
        .unwrap();
    assert!(error.contains("outra versão"), "{error}");
    let entry = catalog_entry(&"0".repeat(64), "bps");
    assert_eq!(
        fixture.plan(Some(entry), None).compatibility.status,
        Status::Incompatible
    );
    assert_eq!((fixture.variant_rows(), fixture.leftover_files()), (0, 0));
    fixture.original_untouched();
}

#[test]
fn cancelling_and_failures_leave_nothing_behind() {
    let fixture = Fixture::new("snes", "Jogo.sfc", sample_rom(8192));
    let (patch, _) = bps_patch(&fixture.rom_bytes);
    let package = fixture.package("hack.bps", &patch);
    let local = request(&fixture, "local");
    let error = fixture
        .store(&local, &fixture.plan(None, None), &package, true)
        .err()
        .unwrap();
    assert_eq!(error, formats::CANCELLED);
    // A result that differs from what the author published is not installed.
    let mut entry = catalog_entry(&sha256_hex(&fixture.rom_bytes), "bps");
    entry.patch.path = None;
    entry.result = Some(Hashes {
        sha256: Some("f".repeat(64)),
        ..Default::default()
    });
    let error = fixture
        .store(
            &request(&fixture, "catalog"),
            &fixture.plan(Some(entry.clone()), None),
            &package,
            false,
        )
        .err()
        .unwrap();
    assert!(error.contains("não confere"), "{error}");
    // A package whose patch differs from the pinned one is rejected.
    entry.result = None;
    entry.patch.file_sha256 = Some("e".repeat(64));
    assert!(fixture
        .store(
            &request(&fixture, "catalog"),
            &fixture.plan(Some(entry), None),
            &package,
            false
        )
        .is_err());
    // A damaged download fails cleanly.
    let mut damaged = patch.clone();
    damaged.truncate(patch.len() / 2);
    assert!(fixture
        .store(
            &local,
            &fixture.plan(None, None),
            &fixture.package("cut.bps", &damaged),
            false
        )
        .is_err());
    assert_eq!((fixture.variant_rows(), fixture.leftover_files()), (0, 0));
    fixture.original_untouched();
}

#[test]
fn an_original_changed_since_import_is_not_patched() {
    let fixture = Fixture::new("gba", "Jogo.gba", sample_rom(4096));
    let (patch, _) = bps_patch(&fixture.rom_bytes);
    let plan = fixture.plan(None, None);
    let mut changed = fixture.rom_bytes.clone();
    changed[0] ^= 1;
    std::fs::write(&fixture.rom, &changed).unwrap();
    let error = fixture
        .store(
            &request(&fixture, "local"),
            &plan,
            &fixture.package("hack.bps", &patch),
            false,
        )
        .err()
        .unwrap();
    assert!(error.contains("mudou"), "{error}");
    assert_eq!(fixture.variant_rows(), 0);
}

#[test]
fn copier_headers_are_removed_on_the_copy_only() {
    let clean = sample_rom(8192);
    let mut headered = vec![0u8; 512];
    headered.extend(&clean);
    let fixture = Fixture::new("snes", "Jogo.smc", headered);
    let (patch, target) = bps_patch(&clean);
    let mut entry = catalog_entry(&sha256_hex(&clean), "bps");
    entry.patch.path = None;
    let plan = fixture.plan(Some(entry), None);
    assert!(plan.compatibility.strip_header);
    let variant = stored(fixture.store(
        &request(&fixture, "catalog"),
        &plan,
        &fixture.package("hack.bps", &patch),
        false,
    ));
    assert_eq!(std::fs::read(&variant.path).unwrap(), target);
    fixture.original_untouched();
}

#[test]
fn stacking_needs_confirmation_and_removal_takes_dependents() {
    let fixture = Fixture::new("gba", "Jogo.gba", sample_rom(4096));
    let (patch, target) = bps_patch(&fixture.rom_bytes);
    let first = stored(fixture.store(
        &request(&fixture, "local"),
        &fixture.plan(None, None),
        &fixture.package("base.bps", &patch),
        false,
    ));
    let extra = fixture.package("extra.ips", &ips_patch(&[(0, b"Z")]));
    let mut on_top = request(&fixture, "local");
    on_top.parent_variant_id = Some(first.id.clone());
    on_top.confirm_unknown = true;
    let error = fixture
        .store(
            &on_top,
            &fixture.plan(None, Some(first.clone())),
            &extra,
            false,
        )
        .err()
        .unwrap();
    assert!(error.contains("Combinar"), "{error}");
    on_top.confirm_stack = true;
    let second = stored(fixture.store(
        &on_top,
        &fixture.plan(None, Some(first.clone())),
        &extra,
        false,
    ));
    assert_eq!(second.parent_id.as_deref(), Some(first.id.as_str()));
    let mut expected = target.clone();
    expected[0] = b'Z';
    assert_eq!(std::fs::read(&second.path).unwrap(), expected);
    let conn = fixture.db.0.lock().unwrap();
    let all = variants(&conn, &fixture.item_id).unwrap();
    assert_eq!(
        descendants(&all, &first.id),
        [first.id.clone(), second.id.clone()]
    );
    conn.execute("DELETE FROM game_variants WHERE id=?1", [&first.id])
        .unwrap();
    assert!(
        variants(&conn, &fixture.item_id).unwrap().is_empty(),
        "dependent versions cascade"
    );
}

#[test]
fn the_library_plays_the_selected_variant_with_its_own_saves() {
    let fixture = Fixture::new("snes", "Jogo.sfc", sample_rom(8192));
    let (patch, _) = bps_patch(&fixture.rom_bytes);
    let variant = stored(fixture.store(
        &request(&fixture, "local"),
        &fixture.plan(None, None),
        &fixture.package("hack.bps", &patch),
        false,
    ));
    let conn = fixture.db.0.lock().unwrap();
    let entry = crate::database::library(&conn).unwrap().remove(0);
    assert!(entry.item.active_variant.is_none());
    assert_eq!(entry.item.variant_count, 1);
    conn.execute(
        "INSERT INTO game_variant_selection(library_item_id,variant_id) VALUES(?1,?2)",
        params![fixture.item_id, variant.id],
    )
    .unwrap();
    let entry = crate::database::library(&conn).unwrap().remove(0);
    let active = entry.item.active_variant.expect("selected variant");
    assert_eq!(
        (active.sha256.as_str(), active.path.as_str()),
        (variant.sha256.as_str(), variant.path.as_str())
    );
    // Removing the version returns the library to the original.
    conn.execute("DELETE FROM game_variants WHERE id=?1", [&variant.id])
        .unwrap();
    assert!(crate::database::library(&conn).unwrap()[0]
        .item
        .active_variant
        .is_none());
    drop(conn);

    let saves = variant_saves(&fixture.root, "default", &active).unwrap();
    let separate = saves.saves.clone().expect("unconfirmed saves stay apart");
    let executable = fixture.root.join("runtime").join("retroarch.exe");
    let hash = "a".repeat(64);
    let config = crate::launcher::runtime_menu::prepare_player(
        &fixture.root,
        &executable,
        &hash,
        "default",
        true,
        true,
        false,
        Some((&active.id, &saves)),
    )
    .unwrap();
    let text = std::fs::read_to_string(&config).unwrap();
    assert!(
        text.contains(&format!(
            "savefile_directory = \"{}\"",
            separate.to_string_lossy().replace('\\', "/")
        )) || text.contains("savefile_directory"),
        "{text}"
    );
    assert!(text.contains(&active.id));
    let shared = ActiveVariant {
        saves_shared: true,
        ..active.clone()
    };
    let saves = variant_saves(&fixture.root, "default", &shared).unwrap();
    assert!(saves.saves.is_none());
    let config = crate::launcher::runtime_menu::prepare_player(
        &fixture.root,
        &executable,
        &hash,
        "default",
        true,
        true,
        false,
        Some((&shared.id, &saves)),
    )
    .unwrap();
    let text = std::fs::read_to_string(config).unwrap();
    assert!(
        !text.contains("savefile_directory"),
        "confirmed saves stay with the original"
    );
    assert!(
        text.contains("savestate_directory"),
        "states are always separate"
    );
    let player = uuid::Uuid::new_v4().to_string();
    let saves = variant_saves(&fixture.root, &player, &active).unwrap();
    let config = crate::launcher::runtime_menu::prepare_player(
        &fixture.root,
        &executable,
        &hash,
        &player,
        true,
        true,
        false,
        Some((&active.id, &saves)),
    )
    .unwrap();
    let text = std::fs::read_to_string(config).unwrap();
    assert_eq!(text.matches("savefile_directory").count(), 1);
    assert_eq!(text.matches("savestate_directory").count(), 1);
    assert!(text.contains(&active.id));
}

#[test]
fn startup_recovery_deletes_unregistered_copies() {
    let root = std::env::temp_dir().join(format!("openretro-recover-{}", uuid::Uuid::new_v4()));
    let kept = uuid::Uuid::new_v4().to_string();
    let orphan = uuid::Uuid::new_v4().to_string();
    for id in [&kept, &orphan] {
        std::fs::create_dir_all(variant_dir(&root, id)).unwrap();
    }
    std::fs::write(variant_dir(&root, &kept).join("Jogo.sfc"), b"ok").unwrap();
    std::fs::write(variant_dir(&root, &kept).join("Jogo.sfc.partial"), b"half").unwrap();
    std::fs::write(
        variant_dir(&root, &orphan).join("Jogo.sfc.partial"),
        b"half",
    )
    .unwrap();
    recover_folder(&root, &[kept.clone()].into_iter().collect());
    assert!(!variant_dir(&root, &orphan).exists());
    assert!(variant_dir(&root, &kept).join("Jogo.sfc").is_file());
    assert!(!variant_dir(&root, &kept).join("Jogo.sfc.partial").exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn split_and_compressed_games_are_not_patched() {
    let root = std::env::temp_dir().join(format!("openretro-print-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    for (name, platform) in [
        ("Jogo.cue", "psx"),
        ("Jogo.chd", "psx"),
        ("game.zip", "arcade"),
    ] {
        std::fs::write(root.join(name), b"x").unwrap();
        let print = fingerprint_file(&root.join(name), platform).unwrap();
        assert!(print.unpatchable.is_some(), "{name}");
    }
    std::fs::write(root.join("Jogo.bin"), sample_rom(2048)).unwrap();
    let print = fingerprint_file(&root.join("Jogo.bin"), "psx").unwrap();
    assert!(print.unpatchable.is_none());
    assert_eq!(
        print.full.crc32,
        Some(format!("{:08x}", crc32fast::hash(&sample_rom(2048))))
    );
    assert_eq!(print.full.md5.as_deref().map(str::len), Some(32));
    std::fs::remove_dir_all(root).unwrap();
}
