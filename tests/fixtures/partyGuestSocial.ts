export async function joinFriendRoom() {
  return {
    code: "ABC234",
    invite: "local-synthetic-test",
    signal: "ws://127.0.0.1:1421/preview-signal",
  };
}
export async function checkPartyAvailable() {}
export async function joinFriendParty() {
  throw new Error(
    "Reserva de navegador simulada: use duas contas no app para validar o ingresso real.",
  );
}
