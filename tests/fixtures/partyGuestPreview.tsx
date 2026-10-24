import React from "react";
import { createRoot } from "react-dom/client";
import { PartyGuestScreen } from "../../src/features/party/PartyGuestScreen";
import "../../src/fonts.css";
import "../../src/styles.css";
import "../../src/hydra.css";

const NativeSocket = window.WebSocket;
class SyntheticSignal {
  static OPEN = 1;
  readyState = 1;
  onopen = () => {};
  onmessage = (_: { data: string }) => {};
  onclose = () => {};
  onerror = () => {};
  private host = new RTCPeerConnection({ iceServers: [] });
  private pending: RTCIceCandidateInit[] = [];
  private frame = 0;
  private closed = false;
  constructor(url: string | URL) {
    if (!String(url).endsWith("/preview-signal"))
      return new NativeSocket(url) as unknown as SyntheticSignal;
    setTimeout(() => this.onopen(), 100);
  }
  private receive(value: unknown) {
    if (!this.closed) this.onmessage({ data: JSON.stringify(value) });
  }
  async send(raw: string) {
    if (raw === "ping") {
      this.onmessage({ data: "pong" });
      return;
    }
    const message = JSON.parse(raw);
    if (message.type === "join") {
      if (new URLSearchParams(location.search).has("error")) {
        this.receive({
          type: "error",
          message: "O anfitrião encerrou o Party. (servidor simulado)",
        });
        return;
      }
      this.receive({
        type: "accepted",
        player: 2,
        iceServers: [],
        policy: "all",
      });
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d")!;
      let count = 0;
      const draw = () => {
        ctx.fillStyle = "#0e2330";
        ctx.fillRect(0, 0, 1280, 720);
        ctx.strokeStyle = "#1e4650";
        ctx.lineWidth = 1;
        for (let x = 0; x < 1280; x += 64) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 720);
          ctx.stroke();
        }
        for (let y = 0; y < 720; y += 64) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(1280, y);
          ctx.stroke();
        }
        ctx.fillStyle = "#7ce6c3";
        ctx.font = "bold 48px sans-serif";
        ctx.fillText("OPENRETRO / PARTY", 80, 210);
        ctx.fillStyle = "#c4dce1";
        ctx.font = "24px sans-serif";
        ctx.fillText("Faixa de vídeo sintética · WebRTC local", 80, 260);
        ctx.fillStyle = "#7ce6c3";
        ctx.fillRect(100 + ((count++ * 3) % 1000), 430, 64, 64);
        ctx.fillStyle = "#9ab5c1";
        ctx.font = "18px monospace";
        ctx.fillText(`Quadro ${count}   •   J2   •   1280 × 720`, 80, 610);
        this.frame = requestAnimationFrame(draw);
      };
      draw();
      const stream = canvas.captureStream(30);
      stream.getTracks().forEach((track) => this.host.addTrack(track, stream));
      const channel = this.host.createDataChannel("pad", {
        ordered: false,
        maxRetransmits: 0,
      });
      channel.onmessage = (event) => {
        document.title = `Party Guest — botões ${JSON.parse(event.data).buttons}`;
      };
      this.host.onicecandidate = (event) => {
        if (event.candidate)
          this.receive({
            type: "signal",
            signal: { type: "candidate", candidate: event.candidate.toJSON() },
          });
      };
      await this.host.setLocalDescription(await this.host.createOffer());
      this.receive({
        type: "signal",
        signal: { type: "offer", sdp: this.host.localDescription },
      });
    } else if (message.signal?.type === "answer") {
      await this.host.setRemoteDescription(message.signal.sdp);
      for (const candidate of this.pending.splice(0))
        await this.host.addIceCandidate(candidate);
    } else if (message.signal?.type === "candidate") {
      if (this.host.remoteDescription)
        await this.host.addIceCandidate(message.signal.candidate);
      else this.pending.push(message.signal.candidate);
    }
  }
  close() {
    this.closed = true;
    cancelAnimationFrame(this.frame);
    this.host.getSenders().forEach((sender) => sender.track?.stop());
    this.host.close();
  }
}
window.WebSocket = SyntheticSignal as unknown as typeof WebSocket;
const friend = {
  id: "preview",
  displayName: "Marina",
  friendCode: "marina#abcd",
  avatar: 3,
};
const big = new URLSearchParams(location.search).has("big");
if (big) document.documentElement.classList.add("console-mode");
createRoot(document.getElementById("root")!).render(
  <div className={big ? "tv-workspace tv-party-workspace" : undefined}>
    <PartyGuestScreen friend={friend} onClose={() => location.reload()} />
  </div>,
);
