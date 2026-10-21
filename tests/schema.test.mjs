import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../src-tauri/src/database/001_initial.sql", import.meta.url),
  "utf8",
);
const cacheMigration = readFileSync(
  new URL("../src-tauri/src/database/002_metadata_cache.sql", import.meta.url),
  "utf8",
);
const downloadsMigration = readFileSync(
  new URL(
    "../src-tauri/src/database/003_download_sources.sql",
    import.meta.url,
  ),
  "utf8",
);
const playersMigration = readFileSync(
  new URL("../src-tauri/src/database/004_player_profiles.sql", import.meta.url),
  "utf8",
);
let db;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(migration);
  db.exec(cacheMigration);
  db.exec(downloadsMigration);
  db.exec(playersMigration);
  db.prepare("INSERT INTO platforms VALUES (?, ?)").run("gba", "{}");
  db.prepare("INSERT INTO games VALUES (?, ?)").run("game", "{}");
  db.prepare("INSERT INTO emulators VALUES (?, ?)").run("emulator", "{}");
  db.prepare(
    "INSERT INTO library_items(id,game_id,platform_id,source_provider,source_path,emulator_id,added_at,sha256) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    "item",
    "game",
    "gba",
    "local",
    "/games/demo.gba",
    "emulator",
    "2026-10-19",
    "a".repeat(64),
  );
});
afterEach(() => db.close());
describe("SQLite migration and relational integrity", () => {
  it("can be applied twice and records all versions", () => {
    db.exec(migration);
    db.exec(cacheMigration);
    db.exec(downloadsMigration);
    db.exec(playersMigration);
    expect(
      db.prepare("SELECT count(*) AS count FROM schema_migrations").get().count,
    ).toBe(4);
  });
  it("rejects duplicate file fingerprints", () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO library_items(id,game_id,platform_id,source_provider,source_path,added_at,sha256) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          "other",
          "game",
          "gba",
          "local",
          "/other.gba",
          "2026-10-19",
          "a".repeat(64),
        ),
    ).toThrow();
  });
  it("clears overrides when an emulator is removed", () => {
    db.prepare("DELETE FROM emulators WHERE id=?").run("emulator");
    expect(
      db.prepare("SELECT emulator_id FROM library_items WHERE id=?").get("item")
        .emulator_id,
    ).toBeNull();
  });
  it("allows only one active session, and a new session after completion", () => {
    const insert = db.prepare(
      "INSERT INTO play_sessions(id,library_item_id,started_at) VALUES(?,?,?)",
    );
    insert.run("first", "item", "2026-10-19T00:00:00Z");
    expect(() =>
      insert.run("second", "item", "2026-10-19T00:00:00Z"),
    ).toThrow();
    db.exec(
      "UPDATE play_sessions SET finished_at='2026-10-19T00:01:00Z',duration=60 WHERE id='first'",
    );
    insert.run("second", "item", "2026-10-19T00:02:00Z");
    expect(
      db.prepare("SELECT count(*) AS count FROM play_sessions").get().count,
    ).toBe(2);
  });
  it("removes session records when a library entry is removed", () => {
    db.exec(
      "INSERT INTO play_sessions(id,library_item_id,started_at,finished_at) VALUES('session','item','start','end')",
    );
    db.exec("DELETE FROM library_items WHERE id='item'");
    expect(
      db.prepare("SELECT count(*) AS count FROM play_sessions").get().count,
    ).toBe(0);
    expect(db.prepare("SELECT count(*) AS count FROM games").get().count).toBe(
      1,
    );
  });
});
describe("download source and job persistence", () => {
  it("preserves source enabled state on refresh and rejects duplicate URLs", () => {
    const insert = db.prepare(
      "INSERT INTO download_sources(id,name,url,enabled,updated_at,document) VALUES(?,?,?,?,?,?)",
    );
    insert.run(
      "source",
      "Test",
      "https://example.org/source.json",
      0,
      "today",
      '{"downloads":[]}',
    );
    expect(() =>
      insert.run(
        "other",
        "Test",
        "https://example.org/source.json",
        1,
        "today",
        "{}",
      ),
    ).toThrow();
    db.prepare("UPDATE download_sources SET name=?,document=? WHERE id=?").run(
      "Updated",
      '{"downloads":[{}]}',
      "source",
    );
    const source = db
      .prepare(
        "SELECT enabled,json_array_length(document,'$.downloads') AS count FROM download_sources",
      )
      .get();
    expect(source.enabled).toBe(0);
    expect(source.count).toBe(1);
  });
  it("marks interrupted transfers paused without changing completed downloads", () => {
    const insert = db.prepare("INSERT INTO download_jobs(id,data) VALUES(?,?)");
    insert.run(
      "active",
      JSON.stringify({
        state: "RESOLVING",
        progress: 12,
        directory: "/downloads/active",
      }),
    );
    insert.run("done", JSON.stringify({ state: "COMPLETED", progress: 100 }));
    db.exec(
      "UPDATE download_jobs SET data=json_set(data,'$.state','PAUSED') WHERE json_extract(data,'$.state') IN ('RESOLVING','DOWNLOADING','VERIFYING','QUEUED')",
    );
    expect(
      JSON.parse(
        db.prepare("SELECT data FROM download_jobs WHERE id='active'").get()
          .data,
      ),
    ).toEqual({
      state: "PAUSED",
      progress: 12,
      directory: "/downloads/active",
    });
    expect(
      JSON.parse(
        db.prepare("SELECT data FROM download_jobs WHERE id='done'").get().data,
      ).state,
    ).toBe("COMPLETED");
  });
});

describe("Player profile migration", () => {
  it("preserves existing progress and keeps new players separate", () => {
    db.prepare(
      "UPDATE library_items SET favorite=1,playtime=120 WHERE id='item'",
    ).run();
    db.exec(playersMigration);
    expect(
      db
        .prepare("SELECT favorite,playtime FROM library_items WHERE id='item'")
        .get(),
    ).toEqual({ favorite: 1, playtime: 120 });
    expect(
      db.prepare("SELECT value FROM settings WHERE key='active_profile'").get()
        .value,
    ).toBe("default");
    db.prepare("INSERT INTO player_profiles VALUES (?,?)").run(
      "second",
      "Jogador 2",
    );
    db.prepare(
      "INSERT INTO player_progress(profile_id,library_item_id,favorite,playtime) VALUES(?,?,?,?)",
    ).run("second", "item", 0, 30);
    expect(
      db
        .prepare(
          "SELECT playtime FROM player_progress WHERE profile_id='second'",
        )
        .get().playtime,
    ).toBe(30);
    expect(
      db.prepare("SELECT playtime FROM library_items WHERE id='item'").get()
        .playtime,
    ).toBe(120);
    db.prepare(
      "UPDATE settings SET value='second' WHERE key='active_profile'",
    ).run();
    db.exec(playersMigration);
    expect(
      db.prepare("SELECT value FROM settings WHERE key='active_profile'").get()
        .value,
    ).toBe("second");
    db.prepare("DELETE FROM library_items WHERE id='item'").run();
    expect(
      db.prepare("SELECT count(*) AS n FROM player_progress").get().n,
    ).toBe(0);
  });
});
