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
let db;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(migration);
  db.exec(cacheMigration);
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
  it("can be applied twice and records both versions", () => {
    db.exec(migration);
    db.exec(cacheMigration);
    expect(
      db.prepare("SELECT count(*) AS count FROM schema_migrations").get().count,
    ).toBe(2);
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
