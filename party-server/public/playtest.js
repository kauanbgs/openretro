const $ = (id) => document.getElementById(id);
const slug = location.pathname.split("/")[2] ?? "";
const KEY = `openretro-playtest-${slug}`;
const remembered = {
  get() {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  },
  set() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // The invite just asks again next time.
    }
  },
};
// Counts only: which invite, what happened. Failures never get in the way.
const note = (kind) =>
  fetch(`/api/playtest/${slug}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
    keepalive: true,
  }).catch(() => {});

function open(name) {
  document.title = `${name}, o playtest te espera · OpenRetro`;
  $("title").textContent =
    `${name}, quer testar o OpenRetro com os seus viewers?`;
  for (const id of ["intro", "shot", "steps"]) $(id).hidden = false;
  const STEPS = ["s-download", "s-sources", "s-party", "s-feedback"];
  // The marks count only the steps on show, so no source means no gap.
  const number = () => {
    let n = 0;
    for (const id of ["s-accept", ...STEPS]) {
      const step = $(id);
      if (step.hidden) continue;
      n += 1;
      step.querySelector(".mark").textContent =
        step.dataset.state === "done" ? "✓" : String(n);
    }
  };
  const copy = async (address, button) => {
    try {
      await navigator.clipboard.writeText(address);
      button.textContent = "Copiado";
    } catch {
      button.textContent = "Selecione e copie";
    }
    setTimeout(() => (button.textContent = "Copiar"), 2000);
  };
  const listSources = (addresses) => {
    $("source-list").replaceChildren(
      ...addresses.map((address) => {
        const row = document.createElement("li");
        const text = document.createElement("span");
        const button = document.createElement("button");
        text.textContent = address;
        button.type = "button";
        button.textContent = "Copiar";
        button.addEventListener("click", () => copy(address, button));
        row.append(text, button);
        return row;
      }),
    );
    $("s-sources").hidden = addresses.length === 0;
    number();
  };
  // The sources are only fetched once the invite is accepted.
  const loadSources = () =>
    fetch(`/api/playtest/${slug}/sources`)
      .then((response) => (response.ok ? response.json() : { sources: [] }))
      .then((data) => listSources(data.sources))
      .catch(() => {});
  // The key stays hidden behind asterisks, so the page is safe to open on a live.
  let rewardKey = "";
  let revealed = false;
  const drawKey = () => {
    $("reward-key").textContent = revealed
      ? rewardKey
      : "*".repeat(rewardKey.length);
    $("reward-show").textContent = revealed ? "Ocultar" : "Mostrar";
  };
  const showReward = (key) => {
    rewardKey = key ?? "";
    revealed = false;
    $("reward").hidden = false;
    $("reward-key-row").hidden = !key;
    $("reward-title").textContent = key
      ? "Sua chave da Steam"
      : "As chaves acabaram por enquanto";
    $("reward-note").textContent = key
      ? "A chave fica escondida para você poder abrir esta página na live. Use Copiar para pegá-la sem mostrar. Para resgatar, abra a Steam e vá em Jogos, Ativar um produto na Steam."
      : "Seu feedback chegou. Vou entrar em contato para resolver.";
    drawKey();
  };
  $("reward-show").addEventListener("click", () => {
    revealed = !revealed;
    drawKey();
  });
  $("reward-copy").addEventListener("click", () =>
    copy(rewardKey, $("reward-copy")),
  );
  const loadReward = () =>
    fetch(`/api/playtest/${slug}/reward`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((data) => data.key && showReward(data.key))
      .catch(() => {});
  // Accepting unlocks the other steps; an earlier visit is remembered.
  const show = (accepted) => {
    $("s-accept").dataset.state = accepted ? "done" : "active";
    $("accept-title").textContent = accepted
      ? "Convite aceito"
      : "Aceitar o convite";
    $("accept-text").textContent = accepted
      ? `Obrigado, ${name}! Os próximos passos estão liberados.`
      : "Avise que você vai testar. É isso que libera os próximos passos.";
    $("accept-button").hidden = accepted;
    for (const id of STEPS) {
      $(id).dataset.state = accepted ? "active" : "locked";
      $(id).inert = !accepted;
    }
    number();
    if (accepted) {
      loadSources();
      loadReward();
    }
  };
  show(remembered.get());
  $("accept-button").addEventListener("click", () => {
    remembered.set();
    note("accept");
    show(true);
    $("download").focus();
  });
  $("download").addEventListener("click", () => note("download"));
  const status = $("status");
  $("feedback").addEventListener("submit", async (event) => {
    event.preventDefault();
    const send = $("send");
    const form = new FormData(event.target);
    const message = String(form.get("message") ?? "").trim();
    status.className = "";
    if (message.length < 5) {
      status.className = "error";
      status.textContent = "Escreva pelo menos algumas palavras.";
      return;
    }
    send.disabled = true;
    status.textContent = "Enviando…";
    try {
      const response = await fetch(`/api/playtest/${slug}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: form.get("kind"), message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error ?? "Não foi possível enviar agora.");
      $("message").value = "";
      if (data.reward) showReward(data.reward.key);
      status.textContent = `Recebido. Obrigado, ${name}! Pode mandar mais quando quiser.`;
    } catch (error) {
      status.className = "error";
      status.textContent =
        error instanceof TypeError
          ? "Sem conexão. Tente de novo."
          : error.message;
    } finally {
      send.disabled = false;
    }
  });
  note("view");
}

fetch(`/api/playtest/${slug}`)
  .then((response) => (response.ok ? response.json() : Promise.reject()))
  .then((data) => open(data.name))
  .catch(() => {
    $("title").textContent = "Este convite não existe ou foi encerrado.";
    $("closed").hidden = false;
  });
