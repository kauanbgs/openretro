import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareDeployment } from "./deploy/prepare.mjs";

test("deployment contains all three services and one server-only secret; existing configuration is preserved", async () => {
  const temp = await mkdtemp(join(tmpdir(), "openretro-party-deploy-"));
  const directory = join(temp, "generated");
  try {
    const result = await prepareDeployment({
      webDomain: "party.example.com",
      turnDomain: "turn.example.com",
      publicIp: "203.0.113.10",
      directory,
    });
    assert.equal(result.files.length, 5);
    const env = await readFile(join(directory, "party.env"), "utf8");
    const secret = /^TURN_SECRET=([a-f0-9]{96})$/m.exec(env)?.[1];
    assert.ok(secret);
    const turn = await readFile(join(directory, "turnserver.conf"), "utf8");
    assert.ok(turn.includes(`static-auth-secret=${secret}`));
    assert.match(turn, /external-ip=203\.0\.113\.10/);
    assert.match(
      turn,
      /\/data\/caddy\/certificates\/.+\/turn\.example\.com\/turn\.example\.com\.crt/,
    );
    const compose = await readFile(join(directory, "compose.yaml"), "utf8");
    assert.ok(!compose.includes(secret));
    for (const service of ["party:", "web:", "turn:"])
      assert.ok(compose.includes(service));
    assert.match(compose, /context: \.\.\/\.\./);
    const caddy = await readFile(join(directory, "Caddyfile"), "utf8");
    assert.match(caddy, /X-Party-Client-IP \{remote_host\}/);
    assert.ok(!caddy.includes(secret));
    await assert.rejects(
      prepareDeployment({
        webDomain: "party.example.com",
        turnDomain: "turn.example.com",
        publicIp: "203.0.113.10",
        directory,
      }),
      { code: "EEXIST" },
    );
    assert.equal(await readFile(join(directory, "party.env"), "utf8"), env);
  } finally {
    assert.ok(temp.startsWith(join(tmpdir(), "openretro-party-deploy-")));
    await rm(temp, { recursive: true, force: true });
  }
});

test("deployment refuses invalid domains and IPs before creating files", async () => {
  for (const webDomain of [
    "https://party.example.com",
    "x;whoami",
    "a\nmalicious",
    "localhost",
  ])
    await assert.rejects(
      prepareDeployment({
        webDomain,
        turnDomain: "turn.example.com",
        publicIp: "203.0.113.10",
      }),
      /domínio válido/,
    );
  await assert.rejects(
    prepareDeployment({
      webDomain: "party.example.com",
      turnDomain: "turn.example.com",
      publicIp: "invalid",
    }),
    /IPv4/,
  );
});
