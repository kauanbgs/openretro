import { describe, expect, it } from "vitest";
import {
  WAITING_TIPS,
  waitingSeats,
  waitingTip,
  waitingTitle,
} from "./partyWaiting";

describe("Party waiting screen", () => {
  it("names the host and every seat's state", () => {
    const seats = waitingSeats({
      host: { name: "Kauan", avatar: 3 },
      guests: [
        { id: "a", name: "Ana", player: 2, avatar: 5 },
        { id: "b", name: "Bia", player: 4 },
        { id: "c", name: "Sem lugar", player: null },
      ],
      connected: ["a"],
    });
    expect(seats.map((seat) => [seat.player, seat.name, seat.status])).toEqual([
      [1, "Kauan", "Anfitrião · no PC"],
      [2, "Ana", "Pronto para jogar"],
      [3, "Lugar livre", "Esperando um amigo"],
      [4, "Bia", "Conectando…"],
    ]);
    expect(seats.map((seat) => seat.avatar)).toEqual([3, 5, null, 0]);
    expect(seats.map((seat) => seat.ready)).toEqual([true, true, false, false]);
  });

  it("works without a host name", () => {
    expect(waitingTitle("Kauan")).toBe("Kauan está escolhendo um jogo");
    expect(waitingTitle(null)).toBe("Escolhendo um jogo");
    expect(
      waitingSeats({ host: { name: null }, guests: [], connected: [] })[0].name,
    ).toBe("Anfitrião");
  });

  it("rotates its tips and starts over", () => {
    expect(waitingTip(0)).toBe(WAITING_TIPS[0]);
    expect(waitingTip(6000)).toBe(WAITING_TIPS[1]);
    expect(waitingTip(6000 * WAITING_TIPS.length)).toBe(WAITING_TIPS[0]);
  });
});
