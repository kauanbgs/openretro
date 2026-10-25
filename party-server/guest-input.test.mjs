import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("friend ticket leaves browser history and reaches signaling only in the join message", () => {
  const handlers = new Map(),
    elements = new Map(),
    requests = [],
    historyEntries = [],
    packets = [];
  const invitation = "eyJ2IjoxfQ." + "a".repeat(64);
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        required: true,
        addEventListener(type, fn) {
          handlers.set(id + ":" + type, fn);
        },
        requestSubmit() {
          handlers.get(id + ":submit")({ preventDefault() {} });
        },
        classList: { remove() {} },
        focus() {},
      });
    return elements.get(id);
  };
  class Socket {
    static OPEN = 1;
    constructor(url) {
      requests.push(String(url));
      this.readyState = 1;
    }
    send(value) {
      packets.push(JSON.parse(value));
    }
    close() {}
  }
  const context = vm.createContext({
    document: {
      hidden: false,
      hasFocus: () => true,
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    location: {
      pathname: "/party/ABC234",
      hash: "#t=" + invitation,
      href: "http://localhost/party/ABC234#t=" + invitation,
      protocol: "http:",
    },
    history: { replaceState: (_a, _b, url) => historyEntries.push(url) },
    URL,
    WebSocket: Socket,
    window: {
      isSecureContext: true,
      RTCPeerConnection: class {},
      addEventListener() {},
    },
    navigator: { getGamepads: () => [] },
    setInterval() {},
    clearInterval() {},
    setTimeout() {},
    clearTimeout() {},
  });
  vm.runInContext(
    readFileSync(new URL("public/guest.js", import.meta.url), "utf8"),
    context,
  );
  assert.equal(element("name").required, false);
  assert.ok(historyEntries.length > 0);
  assert.ok(historyEntries.every((url) => !url.includes(invitation)));
  assert.equal(requests[0], "ws://localhost/signal?room=ABC234");
  vm.runInContext("socket.onopen()", context);
  assert.equal(packets[0].invite, invitation);
  assert.equal(packets[0].name, undefined);
  // The ticket worked once. There is no anonymous retry by name.
  vm.runInContext('ended("Convite expirado")', context);
  assert.equal(element("join").disabled, true);
  element("name").value = "Nome manual";
  handlers.get("join-form:submit")({ preventDefault() {} });
  assert.equal(requests.length, 1);
  assert.equal(packets.length, 1);
});

test("without a friend ticket the guest page only explains how to join", () => {
  const elements = new Map(),
    requests = [];
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        textContent: "",
        addEventListener() {},
        requestSubmit() {},
        classList: { remove() {} },
        focus() {},
      });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: {
      hidden: false,
      hasFocus: () => true,
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    location: {
      pathname: "/party/ABC234",
      hash: "",
      href: "http://localhost/party/ABC234",
      protocol: "http:",
    },
    history: { replaceState() {} },
    WebSocket: class {
      constructor(url) {
        requests.push(url);
      }
    },
    window: {
      isSecureContext: true,
      RTCPeerConnection: class {},
      addEventListener() {},
    },
    navigator: { getGamepads: () => [] },
    setInterval() {},
    clearInterval() {},
  });
  vm.runInContext(
    readFileSync(new URL("public/guest.js", import.meta.url), "utf8"),
    context,
  );
  assert.equal(element("join").disabled, true);
  assert.match(element("status").textContent, /clique em Entrar/);
  assert.equal(requests.length, 0);
});

test("guest releases a controller and keeps it neutral while another app has focus", () => {
  let focused = true,
    polls = 0;
  const packets = [];
  const element = {
    value: "",
    addEventListener() {},
    focus() {},
    classList: { remove() {} },
  };
  const document = {
    hidden: false,
    hasFocus: () => focused,
    getElementById: () => element,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const context = vm.createContext({
    document,
    location: { pathname: "/party" },
    window: { addEventListener() {} },
    navigator: {
      getGamepads() {
        polls++;
        return [
          {
            mapping: "standard",
            buttons: [{ pressed: true }],
            axes: [1, 0, 0, 0],
          },
        ];
      },
    },
    setInterval() {},
    clearInterval() {},
  });
  vm.runInContext(
    readFileSync(new URL("public/guest.js", import.meta.url), "utf8"),
    context,
  );
  context.record = (value) => packets.push(JSON.parse(value));
  vm.runInContext(
    'channel = { readyState: "open", bufferedAmount: 0, send: record }; input();',
    context,
  );
  assert.equal(packets.at(-1).buttons, 1 << 8);
  assert.equal(packets.at(-1).axes[0], 32767);
  focused = false;
  vm.runInContext("clearInput(); input(); input();", context);
  for (const packet of packets.slice(1)) {
    assert.equal(packet.buttons, 0);
    assert.deepEqual(packet.axes, [0, 0, 0, 0]);
  }
  assert.equal(polls, 1);
  focused = true;
  vm.runInContext("input();", context);
  assert.equal(packets.at(-1).buttons, 1 << 8);
  document.hidden = true;
  vm.runInContext("input();", context);
  assert.equal(packets.at(-1).buttons, 0);
});

test("guest sends a controller change on the next frame and stays quiet otherwise", () => {
  let pad = { mapping: "standard", buttons: [], axes: [0, 0, 0, 0] };
  const packets = [],
    frames = [];
  const element = {
    value: "",
    addEventListener() {},
    focus() {},
    classList: { remove() {} },
  };
  const context = vm.createContext({
    document: {
      hidden: false,
      hasFocus: () => true,
      getElementById: () => element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    location: { pathname: "/party" },
    window: { addEventListener() {} },
    navigator: { getGamepads: () => [pad] },
    setInterval() {},
    clearInterval() {},
    requestAnimationFrame: (fn) => frames.push(fn),
  });
  vm.runInContext(
    readFileSync(new URL("public/guest.js", import.meta.url), "utf8"),
    context,
  );
  context.record = (value) => packets.push(JSON.parse(value));
  vm.runInContext(
    'channel = { readyState: "open", bufferedAmount: 0, send: record }; input();',
    context,
  );
  const frame = () => frames.shift()();
  frame();
  assert.equal(packets.length, 1);
  pad = { ...pad, buttons: [{ pressed: true }] };
  frame();
  assert.equal(packets.length, 2);
  assert.equal(packets.at(-1).buttons, 1 << 8);
  frame();
  assert.equal(packets.length, 2);
});

function guestPage({ hash = "", storage = new Map() } = {}) {
  const handlers = new Map(),
    elements = new Map(),
    requests = [],
    historyEntries = [],
    packets = [];
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        textContent: "",
        hidden: true,
        addEventListener(type, fn) {
          handlers.set(id + ":" + type, fn);
        },
        requestSubmit() {
          handlers.get(id + ":submit")({ preventDefault() {} });
        },
        classList: { remove() {} },
        focus() {},
      });
    return elements.get(id);
  };
  class Socket {
    static OPEN = 1;
    constructor(url) {
      requests.push(String(url));
      this.readyState = 1;
    }
    send(value) {
      packets.push(JSON.parse(value));
    }
    close() {}
  }
  const context = vm.createContext({
    document: {
      hidden: false,
      hasFocus: () => true,
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    location: {
      pathname: "/party/ABC234",
      hash,
      href: "http://localhost/party/ABC234" + hash,
      protocol: "http:",
    },
    history: { replaceState: (_a, _b, url) => historyEntries.push(url) },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    URL,
    WebSocket: Socket,
    RTCPeerConnection: class {
      close() {}
    },
    MediaStream: class {},
    window: {
      isSecureContext: true,
      RTCPeerConnection: class {},
      addEventListener() {},
    },
    navigator: { getGamepads: () => [] },
    setInterval() {},
    clearInterval() {},
    setTimeout() {},
    clearTimeout() {},
  });
  vm.runInContext(
    readFileSync(new URL("public/guest.js", import.meta.url), "utf8"),
    context,
  );
  const submit = () =>
    handlers.get("join-form:submit")({ preventDefault() {} });
  return {
    context,
    element,
    requests,
    historyEntries,
    packets,
    storage,
    submit,
  };
}

test("a guest link asks only for a name, joins without an account and rejoins after a reload", async () => {
  const token = "c".repeat(64),
    resume = "d".repeat(64);
  const page = guestPage({ hash: "#g=" + token });
  assert.ok(page.historyEntries.every((url) => !url.includes(token)));
  assert.equal(page.element("name-field").hidden, false);
  assert.equal(page.element("get-app").hidden, false);
  assert.equal(page.element("join").disabled, undefined);
  // No name, no connection.
  page.submit();
  assert.equal(page.requests.length, 0);
  assert.match(page.element("status").textContent, /nome/);
  page.element("name").value = "  Streamer  ";
  page.submit();
  assert.equal(page.requests[0], "ws://localhost/signal?room=ABC234");
  vm.runInContext("socket.onopen()", page.context);
  assert.deepEqual(
    { ...page.packets[0] },
    { type: "join", room: "ABC234", name: "Streamer", guest: token },
  );
  await vm.runInContext(
    `receive({ type: "accepted", player: 2, iceServers: [], policy: "relay", resume: "${resume}" })`,
    page.context,
  );
  const saved = JSON.parse(page.storage.get("openretro-party-guest:ABC234"));
  assert.deepEqual({ ...saved }, { token, name: "Streamer", resume });
  // A dropped connection keeps the seat for this tab.
  vm.runInContext('ended("Você desconectou.")', page.context);
  assert.equal(page.element("join").disabled, false);

  // A reload (no hash any more) reconnects on its own with the proof.
  const reload = guestPage({ storage: page.storage });
  assert.equal(reload.requests.length, 1);
  vm.runInContext("socket.onopen()", reload.context);
  assert.equal(reload.packets[0].resume, resume);
  assert.equal(reload.packets[0].guest, token);
  // The room's own refusal ends the visit.
  await vm.runInContext(
    'receive({ type: "ended", message: "O anfitrião fechou o lugar do convite." })',
    reload.context,
  );
  assert.equal(reload.element("join").disabled, true);
  assert.equal(reload.storage.size, 0);
});

test("a new guest link replaces what the tab remembered from an old one", () => {
  const storage = new Map([
    [
      "openretro-party-guest:ABC234",
      JSON.stringify({
        token: "a".repeat(64),
        name: "Old",
        resume: "b".repeat(64),
      }),
    ],
  ]);
  const page = guestPage({ hash: "#g=" + "e".repeat(64), storage });
  // A fresh link never auto-joins and never sends the old proof.
  assert.equal(page.requests.length, 0);
  page.element("name").value = "Nova";
  page.submit();
  vm.runInContext("socket.onopen()", page.context);
  assert.equal(page.packets[0].guest, "e".repeat(64));
  assert.equal(page.packets[0].resume, undefined);
});
