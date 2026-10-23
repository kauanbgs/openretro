import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("guest releases a controller and keeps it neutral while another app has focus", () => {
  let focused = true, polls = 0;
  const packets = [];
  const element = { value: "", addEventListener() {}, focus() {}, classList: { remove() {} } };
  const document = {
    hidden: false,
    hasFocus: () => focused,
    getElementById: () => element,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const context = vm.createContext({
    document, location: { pathname: "/party" },
    window: { addEventListener() {} },
    navigator: { getGamepads() { polls++; return [{ mapping: "standard", buttons: [{ pressed: true }], axes: [1, 0, 0, 0] }]; } },
    setInterval() {}, clearInterval() {},
  });
  vm.runInContext(readFileSync(new URL("public/guest.js", import.meta.url), "utf8"), context);
  context.record = (value) => packets.push(JSON.parse(value));
  vm.runInContext('channel = { readyState: "open", bufferedAmount: 0, send: record }; input();', context);
  assert.equal(packets.at(-1).buttons, 1 << 8);
  assert.equal(packets.at(-1).axes[0], 32767);
  focused = false;
  vm.runInContext('clearInput(); input(); input();', context);
  for (const packet of packets.slice(1)) {
    assert.equal(packet.buttons, 0);
    assert.deepEqual(packet.axes, [0, 0, 0, 0]);
  }
  assert.equal(polls, 1);
  focused = true;
  vm.runInContext('input();', context);
  assert.equal(packets.at(-1).buttons, 1 << 8);
  document.hidden = true;
  vm.runInContext('input();', context);
  assert.equal(packets.at(-1).buttons, 0);
});

test("guest sends a controller change on the next frame and stays quiet otherwise", () => {
  let pad = { mapping: "standard", buttons: [], axes: [0, 0, 0, 0] };
  const packets = [], frames = [];
  const element = { value: "", addEventListener() {}, focus() {}, classList: { remove() {} } };
  const context = vm.createContext({
    document: {
      hidden: false, hasFocus: () => true, getElementById: () => element,
      querySelectorAll: () => [], addEventListener() {},
    },
    location: { pathname: "/party" },
    window: { addEventListener() {} },
    navigator: { getGamepads: () => [pad] },
    setInterval() {}, clearInterval() {},
    requestAnimationFrame: (fn) => frames.push(fn),
  });
  vm.runInContext(readFileSync(new URL("public/guest.js", import.meta.url), "utf8"), context);
  context.record = (value) => packets.push(JSON.parse(value));
  vm.runInContext('channel = { readyState: "open", bufferedAmount: 0, send: record }; input();', context);
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
