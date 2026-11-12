const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const appWindow = window.__TAURI__.window.getCurrentWindow();

const TEXT = {
  en: {
    headline: "Your classic games, at home.",
    welcomeLead: "We'll fetch the latest version and check it before installing. No administrator needed.",
    install: "Install",
    prepare: "Getting ready",
    prepareDetail: "Looking for the latest version.",
    download: "Downloading",
    downloadDetail: "This may take a few minutes.",
    verify: "Checking the download",
    verifyDetail: "Making sure the file is the real one.",
    installing: "Installing",
    installingDetail: "This only takes a moment.",
    doneTitle: "All set.",
    doneLead: "OpenRetro is installed and ready to play.",
    launch: "Open OpenRetro",
    finish: "Close",
    errorTitle: "Something went wrong",
    retry: "Try again",
    errors: {
      network: "Could not download OpenRetro. Check your connection and try again.",
      signature: "The download could not be verified, so it was not installed.",
      setup_failed: "The installation did not finish. Try again.",
      unsupported: "This version of Windows is not supported.",
    },
    mb: (n) => `${n.toFixed(1)} MB`,
  },
  pt: {
    headline: "Seus jogos clássicos, em casa.",
    welcomeLead: "Vamos buscar a versão mais recente e conferir tudo antes de instalar. Não precisa de administrador.",
    install: "Instalar",
    prepare: "Preparando",
    prepareDetail: "Procurando a versão mais recente.",
    download: "Baixando",
    downloadDetail: "Isso pode levar alguns minutos.",
    verify: "Verificando o download",
    verifyDetail: "Confirmando que o arquivo é o verdadeiro.",
    installing: "Instalando",
    installingDetail: "Leva só um instante.",
    doneTitle: "Tudo pronto.",
    doneLead: "O OpenRetro está instalado e esperando por você.",
    launch: "Abrir o OpenRetro",
    finish: "Fechar",
    errorTitle: "Algo deu errado",
    retry: "Tentar de novo",
    errors: {
      network: "Não deu para baixar o OpenRetro. Confira sua conexão e tente de novo.",
      signature: "Não foi possível verificar o download, então nada foi instalado.",
      setup_failed: "A instalação não terminou. Tente de novo.",
      unsupported: "Esta versão do Windows não é compatível.",
    },
    mb: (n) => `${n.toFixed(1).replace(".", ",")} MB`,
  },
};

const $ = (id) => document.getElementById(id);
let lang = (navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : "en";
let t = TEXT[lang];
let version = "";
let lastProgress = { stage: "prepare", done: 0, total: 0 };
let errorCode = null;

function applyLanguage(next) {
  lang = next;
  t = TEXT[lang];
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t[el.dataset.i18n];
  }
  for (const button of document.querySelectorAll(".seg button")) {
    button.classList.toggle("on", button.dataset.lang === lang);
  }
  if (errorCode) $("errorLead").textContent = t.errors[errorCode] || t.errors.setup_failed;
  renderProgress();
}

function show(id) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.classList.toggle("active", screen.id === id);
  }
}

function setBar(fraction) {
  const bar = document.querySelector(".bar");
  bar.classList.toggle("indeterminate", fraction === null);
  $("barFill").style.width = fraction === null ? "" : `${Math.round(fraction * 100)}%`;
}

function renderProgress() {
  const { stage, done, total } = lastProgress;
  $("versionTag").textContent = version ? `v${version}` : "";
  $("progressNumbers").textContent = "";
  const copy = {
    prepare: [t.prepare, t.prepareDetail],
    download: [t.download, t.downloadDetail],
    verify: [t.verify, t.verifyDetail],
    install: [t.installing, t.installingDetail],
  }[stage];
  if (!copy) return;
  $("progressTitle").textContent = copy[0];
  $("progressDetail").textContent = copy[1];
  if (stage === "download" && total > 0) {
    setBar(done / total);
    $("progressNumbers").textContent = `${t.mb(done / 1048576)} / ${t.mb(total / 1048576)}`;
  } else {
    setBar(null);
  }
}

listen("progress", ({ payload }) => {
  if (payload.version) version = payload.version;
  if (payload.stage === "done") return;
  lastProgress = payload;
  renderProgress();
});

async function start() {
  errorCode = null;
  lastProgress = { stage: "prepare", done: 0, total: 0 };
  renderProgress();
  show("progress");
  try {
    await invoke("install");
    show("done");
  } catch (code) {
    errorCode = code;
    $("errorLead").textContent = t.errors[code] || t.errors.setup_failed;
    show("error");
  }
}

$("install").addEventListener("click", start);
$("retry").addEventListener("click", start);
$("launch").addEventListener("click", () => invoke("launch").catch(() => appWindow.close()));
$("finish").addEventListener("click", () => appWindow.close());
$("quit").addEventListener("click", () => appWindow.close());
$("close").addEventListener("click", () => appWindow.close());
$("minimize").addEventListener("click", () => appWindow.minimize());
for (const button of document.querySelectorAll(".seg button")) {
  button.addEventListener("click", () => applyLanguage(button.dataset.lang));
}

applyLanguage(lang);
