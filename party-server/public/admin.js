const app = document.getElementById("app");
const nav = document.getElementById("nav");
const TOKEN_KEY = "openretro-admin-token";
const store = {
  get: () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (value) => {
    try {
      value
        ? sessionStorage.setItem(TOKEN_KEY, value)
        : sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // The session simply will not survive a reload.
    }
  },
};
let token = store.get();

// Names are typed by players, so everything is built with textContent.
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat())
    if (child != null && child !== false)
      node.append(child instanceof Node ? child : document.createTextNode(child));
  return node;
}

class Unauthorized extends Error {}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (response.status === 401 && token) throw new Unauthorized();
  if (!response.ok) throw new Error(data?.error ?? "Algo deu errado.");
  return data;
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const when = (ms) => (ms ? dateFormat.format(ms) : "—");
const dayFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const name = (p) => p.displayName ?? p.friendCode;
const userLink = (p) =>
  p ? h("a", { href: `#/users/${p.id}` }, name(p)) : "(conta apagada)";
const hours = (seconds) =>
  seconds >= 3600
    ? `${(seconds / 3600).toFixed(1)} h`
    : `${Math.round(seconds / 60)} min`;

const EVENTS = {
  signup: (e) => [userLink(e.actor), " criou a conta"],
  "friend-request": (e) => [userLink(e.actor), " enviou pedido de amizade para ", userLink(e.target)],
  "friend-accept": (e) => [userLink(e.actor), " aceitou o pedido de ", userLink(e.target)],
  "friend-decline": (e) => [userLink(e.actor), " recusou o pedido de ", userLink(e.target)],
  "friend-cancel": (e) => [userLink(e.actor), " cancelou o pedido para ", userLink(e.target)],
  "friend-remove": (e) => [userLink(e.actor), " desfez a amizade com ", userLink(e.target)],
  "friend-block": (e) => [userLink(e.actor), " bloqueou ", userLink(e.target)],
  "friend-unblock": (e) => [userLink(e.actor), " desbloqueou ", userLink(e.target)],
  "party-created": (e) => [userLink(e.actor), " criou um Party"],
};
const FILTERS = [
  ["", "Tudo"],
  ["signup", "Contas criadas"],
  ["friend-request", "Pedidos de amizade"],
  ["friend-accept", "Amizades aceitas"],
  ["friend-remove", "Amizades desfeitas"],
  ["friend-block", "Bloqueios"],
  ["party-created", "Partys criadas"],
];
function eventRow(event) {
  const sentence = EVENTS[event.kind];
  return h(
    "li",
    {},
    h("span", {}, sentence ? sentence(event) : event.kind),
    h("time", {}, when(event.at)),
  );
}

function login(message = "") {
  nav.hidden = true;
  const email = h("input", { type: "email", placeholder: "E-mail", required: "", autocomplete: "email" });
  const code = h("input", {
    inputmode: "numeric",
    placeholder: "Código de 6 dígitos",
    maxlength: "6",
    autocomplete: "one-time-code",
    hidden: "",
  });
  const note = h("p", { class: "muted error" }, message);
  const button = h("button", { class: "primary", type: "submit" }, "Receber código");
  let sent = false;
  const form = h(
    "form",
    {
      class: "login",
      onsubmit: async (event) => {
        event.preventDefault();
        button.disabled = true;
        note.textContent = "";
        try {
          if (!sent) {
            await api("/api/auth/start", {
              method: "POST",
              body: JSON.stringify({ email: email.value, locale: "pt-BR" }),
            });
            sent = true;
            code.hidden = false;
            code.focus();
            button.textContent = "Entrar";
            note.textContent = "Enviamos um código para o seu e-mail.";
            note.className = "muted";
          } else {
            const data = await api("/api/auth/verify", {
              method: "POST",
              body: JSON.stringify({ email: email.value, code: code.value }),
            });
            token = data.token;
            store.set(token);
            await start();
            return;
          }
        } catch (error) {
          note.textContent = error.message;
          note.className = "error";
        }
        button.disabled = false;
      },
    },
    h("h1", {}, "Entrar"),
    email,
    code,
    button,
    note,
  );
  app.replaceChildren(form);
}

function stat(value, label) {
  return h("div", { class: "card stat" }, h("b", {}, String(value)), h("span", {}, label));
}
function chart(title, points) {
  const peak = Math.max(1, ...points.map((p) => p.count));
  return h(
    "div",
    { class: "card" },
    h("span", { class: "muted" }, title),
    h(
      "div",
      { class: "bars" },
      points.map((p) => {
        const fill = h("i", { title: `${p.count}` });
        fill.style.height = `${(p.count / peak) * 80}%`;
        return h("div", { class: "bar" }, p.count || "", fill, h("small", {}, dayFormat.format(p.day)));
      }),
    ),
  );
}

async function overview() {
  const d = await api("/api/admin/overview");
  const events = await api("/api/admin/activity?limit=10");
  app.replaceChildren(
    h("h1", {}, "Visão geral"),
    h(
      "div",
      { class: "stats" },
      stat(d.users, "contas no total"),
      stat(d.onlineNow, "online agora (últimos 5 min)"),
      stat(d.active.day, "ativos nas últimas 24 h"),
      stat(d.active.week, "ativos nos últimos 7 dias"),
      stat(d.signups.day, "cadastros em 24 h"),
      stat(d.signups.week, "cadastros em 7 dias"),
      stat(d.signups.month, "cadastros em 30 dias"),
      stat(d.friendships, "amizades"),
      stat(d.pendingRequests, "pedidos pendentes"),
      stat(d.blocks, "bloqueios"),
      stat(d.parties.day, "Partys em 24 h"),
      stat(d.parties.week, "Partys em 7 dias"),
    ),
    h("h2", {}, "Últimos 14 dias"),
    h(
      "div",
      { class: "charts" },
      chart("Cadastros por dia", d.signupsPerDay),
      chart("Partys criadas por dia", d.partiesPerDay),
    ),
    h("h2", {}, "Atividade recente"),
    h("ul", { class: "events" }, events.events.map(eventRow)),
    h("p", { class: "muted" }, `${d.parties.total} Partys registradas desde que o painel começou a contar.`),
  );
}

async function users() {
  const search = h("input", { type: "search", placeholder: "Buscar por nome, código de amigo ou e-mail" });
  const body = h("tbody");
  const more = h("button", { class: "ghost more", type: "button", hidden: "" }, "Carregar mais");
  let offset = 0,
    query = "";
  async function load(reset) {
    if (reset) {
      offset = 0;
      body.replaceChildren();
    }
    const data = await api(`/api/admin/users?q=${encodeURIComponent(query)}&offset=${offset}`);
    offset += data.users.length;
    for (const u of data.users)
      body.append(
        h(
          "tr",
          { class: "click", onclick: () => (location.hash = `#/users/${u.id}`) },
          h("td", {}, name(u)),
          h("td", {}, u.friendCode),
          h("td", {}, u.email),
          h("td", {}, when(u.createdAt)),
          h("td", {}, when(u.lastSeenAt)),
          h("td", {}, String(u.friends)),
        ),
      );
    more.hidden = !data.more;
  }
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = search.value.trim();
      load(true).catch(fail);
    }, 250);
  });
  more.addEventListener("click", () => load(false).catch(fail));
  app.replaceChildren(
    h("h1", {}, "Usuários"),
    h("div", { class: "toolbar" }, search),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, ["Nome", "Código", "E-mail", "Cadastro", "Último acesso", "Amigos"].map((t) => h("th", {}, t)))),
        body,
      ),
    ),
    more,
  );
  await load(true);
}

async function userPage(id) {
  const d = await api(`/api/admin/users/${id}`);
  const u = d.user;
  app.replaceChildren(
    h("p", {}, h("a", { href: "#/users" }, "← Usuários")),
    h("h1", {}, name(u)),
    h(
      "div",
      { class: "stats" },
      stat(u.friendCode, "código de amigo"),
      stat(u.email, "e-mail"),
      stat(when(u.createdAt), "criou a conta"),
      stat(when(u.lastSeenAt), "último acesso"),
      stat(u.sessions, "sessões ativas"),
      stat(d.friends.length, "amigos"),
      stat(`${d.counts.requestsSent} / ${d.counts.requestsReceived}`, "pedidos enviados / recebidos"),
      stat(`${d.counts.blocking} / ${d.counts.blockedBy}`, "bloqueou / foi bloqueado por"),
      stat(d.counts.messagesSent, "mensagens enviadas (só a contagem)"),
    ),
    h("h2", {}, "Amigos"),
    d.friends.length
      ? h(
          "ul",
          { class: "events" },
          d.friends.map((f) => h("li", {}, userLink(f), h("time", {}, `desde ${when(f.since)}`))),
        )
      : h("p", { class: "muted" }, "Nenhum amigo ainda."),
    h("h2", {}, "Jogos recentes"),
    d.games.length
      ? h(
          "ul",
          { class: "events" },
          d.games.map((g) =>
            h("li", {}, h("span", {}, `${g.title} · ${g.console} · ${hours(g.playSeconds)}`), h("time", {}, when(g.lastPlayedAt))),
          ),
        )
      : h("p", { class: "muted" }, "Nada jogado ainda."),
    h("h2", {}, "Atividade"),
    d.events.length
      ? h("ul", { class: "events" }, d.events.map(eventRow))
      : h("p", { class: "muted" }, "Sem eventos registrados."),
  );
}

async function activity() {
  const filter = h("select", {}, FILTERS.map(([value, label]) => h("option", { value }, label)));
  const list = h("ul", { class: "events" });
  const more = h("button", { class: "ghost more", type: "button", hidden: "" }, "Carregar mais");
  let before = 0;
  async function load(reset) {
    if (reset) {
      before = 0;
      list.replaceChildren();
    }
    const data = await api(
      `/api/admin/activity?kind=${encodeURIComponent(filter.value)}${before ? `&before=${before}` : ""}`,
    );
    for (const event of data.events) list.append(eventRow(event));
    before = data.events.at(-1)?.id ?? before;
    more.hidden = !data.more;
  }
  filter.addEventListener("change", () => load(true).catch(fail));
  more.addEventListener("click", () => load(false).catch(fail));
  app.replaceChildren(
    h("h1", {}, "Atividade"),
    h("div", { class: "toolbar" }, filter),
    list,
    more,
    h("p", { class: "muted" }, "O painel guarda os eventos por 180 dias e apaga os de uma conta quando ela é excluída."),
  );
  await load(true);
}

function fail(error) {
  if (error instanceof Unauthorized) {
    token = null;
    store.set(null);
    return login("Sua sessão expirou. Entre novamente.");
  }
  app.replaceChildren(h("p", { class: "error" }, error.message));
}

async function route() {
  const [section = "", id] = location.hash.replace(/^#\/?/, "").split("/");
  const current = section === "" ? "overview" : section;
  for (const link of nav.querySelectorAll("a"))
    link.classList.toggle("on", link.dataset.route === current);
  try {
    if (current === "users" && id) await userPage(id);
    else if (current === "users") await users();
    else if (current === "activity") await activity();
    else await overview();
  } catch (error) {
    fail(error);
  }
}

async function start() {
  if (!token) return login();
  try {
    await api("/api/admin/me");
  } catch (error) {
    // 404 means a signed-in account that is not on the admin list.
    token = null;
    store.set(null);
    return login(
      error instanceof Unauthorized
        ? "Sua sessão expirou. Entre novamente."
        : "Esta conta não tem acesso ao painel.",
    );
  }
  nav.hidden = false;
  await route();
}

document.getElementById("logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // The token is dropped either way.
  }
  token = null;
  store.set(null);
  login();
});
window.addEventListener("hashchange", () => token && route());
start();
