const app = document.getElementById("app");
const nav = document.getElementById("nav");
const sideFoot = document.getElementById("side-foot");
const liveCount = document.getElementById("live-count");
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
// Pages that refresh themselves register their timer here so a route change stops it.
let refresh;
const stopRefresh = () => {
  clearInterval(refresh);
  refresh = undefined;
};
function shell(signedIn) {
  document.body.classList.toggle("login-page", !signedIn);
  nav.hidden = !signedIn;
  sideFoot.hidden = !signedIn;
}
function setLive(count) {
  liveCount.textContent = String(count);
  liveCount.hidden = !count;
}

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
      node.append(
        child instanceof Node ? child : document.createTextNode(child),
      );
  return node;
}
const SVG = "http://www.w3.org/2000/svg";
function svg(tag, props = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(props))
    node.setAttribute(key, value);
  for (const child of children.flat())
    if (child != null)
      node.append(
        child instanceof Node ? child : document.createTextNode(child),
      );
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
  const data =
    response.status === 204 ? null : await response.json().catch(() => ({}));
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
const dayFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const when = (ms) => (ms ? dateFormat.format(ms) : "—");
function ago(ms) {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
const name = (p) => p.displayName ?? p.friendCode;
const userLink = (p) =>
  p ? h("a", { href: `#/users/${p.id}` }, name(p)) : "(conta apagada)";
const hours = (seconds) =>
  seconds >= 3600
    ? `${(seconds / 3600).toFixed(1)} h`
    : `${Math.round(seconds / 60)} min`;
const percent = (part, whole) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "—";
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** The initial in a circle; an amber ring means the account is online. */
const avatar = (p, online, big) =>
  h(
    "span",
    {
      class: `avatar${online ? " on" : ""}${big ? " big" : ""}`,
      title: online ? "Online" : "Offline",
    },
    [...name(p)][0]?.toUpperCase() ?? "?",
  );
const who = (p, online) =>
  h("span", { class: "who" }, avatar(p, online), userLink(p));

const EVENTS = {
  signup: (e) => [userLink(e.actor), " criou a conta"],
  "friend-request": (e) => [
    userLink(e.actor),
    " enviou pedido de amizade para ",
    userLink(e.target),
  ],
  "friend-accept": (e) => [
    userLink(e.actor),
    " aceitou o pedido de ",
    userLink(e.target),
  ],
  "friend-decline": (e) => [
    userLink(e.actor),
    " recusou o pedido de ",
    userLink(e.target),
  ],
  "friend-cancel": (e) => [
    userLink(e.actor),
    " cancelou o pedido para ",
    userLink(e.target),
  ],
  "friend-remove": (e) => [
    userLink(e.actor),
    " desfez a amizade com ",
    userLink(e.target),
  ],
  "friend-block": (e) => [userLink(e.actor), " bloqueou ", userLink(e.target)],
  "friend-unblock": (e) => [
    userLink(e.actor),
    " desbloqueou ",
    userLink(e.target),
  ],
  "party-created": (e) => [userLink(e.actor), " criou um Party"],
};
const FILTERS = [
  ["", "Tudo"],
  ["signup", "Contas criadas"],
  ["friend-request", "Pedidos de amizade"],
  ["friend-accept", "Amizades aceitas"],
  ["friend-decline", "Pedidos recusados"],
  ["friend-remove", "Amizades desfeitas"],
  ["friend-block", "Bloqueios"],
  ["party-created", "Partys criadas"],
];
const eventRow = (event) =>
  h(
    "li",
    {},
    h("span", {}, EVENTS[event.kind] ? EVENTS[event.kind](event) : event.kind),
    h("time", {}, when(event.at)),
  );

// Building blocks

const page = (title, lead, ...children) => [
  h(
    "div",
    { class: "page-head" },
    h("h1", {}, title),
    lead ? h("p", { class: "lead" }, lead) : null,
  ),
  ...children,
];
const section = (title, lead) => [
  h("h2", { class: lead ? "has-lead" : "" }, title),
  lead ? h("p", { class: "lead" }, lead) : null,
];
const empty = (text) => h("p", { class: "muted" }, text);
const figure = (value, label) =>
  h(
    "div",
    { class: "figure" },
    h("b", { class: String(value).length > 12 ? "long" : "" }, String(value)),
    h("span", {}, label),
  );
const figures = (list) => h("div", { class: "figures" }, list);
const panel = (title, note, body) =>
  h(
    "div",
    { class: "panel" },
    h("h3", {}, title),
    note ? h("p", {}, note) : null,
    body,
  );

/** A rounded axis maximum: 1, 2, 5 or 10 times a power of ten. */
function niceCeil(value) {
  const base = 10 ** Math.floor(Math.log10(value));
  const m = value / base;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * base;
}
/**
 * A line or bar chart in SVG. Points are {label, value}; hovering a column
 * shows its value as a tooltip. `tone` picks one of the four series colors.
 */
function chart(
  points,
  { tone = 1, kind = "line", format = String, label = "" } = {},
) {
  const narrow = innerWidth < 640;
  const W = narrow ? 340 : 480,
    H = narrow ? 170 : 180;
  const L = 32,
    R = 6,
    T = 10,
    B = 24;
  const top = niceCeil(Math.max(1, ...points.map((p) => p.value)));
  const n = points.length;
  const span = W - L - R;
  const x = (i) =>
    kind === "bar"
      ? L + ((i + 0.5) * span) / n
      : L + (i * span) / Math.max(1, n - 1);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const column = span / (kind === "bar" ? n : Math.max(1, n - 1));
  const every = Math.ceil(n / (narrow ? 5 : 8));
  const grid = [0, top / 2, top].flatMap((v) => [
    svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }),
    svg(
      "text",
      { x: L - 6, y: y(v) + 4, "text-anchor": "end", class: "axis" },
      String(Number(v.toFixed(1))),
    ),
  ]);
  const marks =
    kind === "bar"
      ? points.map((p, i) =>
          svg("rect", {
            x: x(i) - column * 0.31,
            y: y(p.value),
            width: column * 0.62,
            height: Math.max(0, y(0) - y(p.value)),
            rx: 2,
            class: "bar",
          }),
        )
      : (() => {
          const path = points
            .map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`)
            .join("");
          return [
            svg("path", {
              d: `${path}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`,
              class: "area",
            }),
            svg("path", { d: path, class: "line" }),
          ];
        })();
  const hits = points.map((p, i) =>
    svg(
      "rect",
      {
        x: x(i) - column / 2,
        y: T,
        width: column,
        height: H - T - B,
        class: "hit",
      },
      svg("title", {}, `${p.label}: ${format(p.value)}`),
    ),
  );
  const ticks = points.flatMap((p, i) =>
    i % every === 0
      ? [
          svg(
            "text",
            { x: x(i), y: H - 6, "text-anchor": "middle", class: "axis" },
            p.label,
          ),
        ]
      : [],
  );
  return svg(
    "svg",
    {
      viewBox: `0 0 ${W} ${H}`,
      class: `chart t${tone}`,
      role: "img",
      "aria-label": label,
    },
    ...grid,
    ...marks,
    ...hits,
    ...ticks,
  );
}
const perDay = (points) =>
  points.map((p) => ({ label: dayFormat.format(p.day), value: p.count }));

/** Horizontal bars for a ranking or a funnel; `share` is a 0-1 length. */
function meter(rows) {
  return h(
    "div",
    { class: "meters" },
    rows.map(({ label, value, share, note }) => {
      const fill = h("i");
      fill.style.width = `${Math.max(1.5, share * 100)}%`;
      return h(
        "div",
        { class: "meter" },
        h("div", {}, h("span", {}, label), h("b", {}, value)),
        h("div", { class: "track" }, fill),
        note ? h("small", { class: "muted" }, note) : null,
      );
    }),
  );
}
/** Rows of cells; `numeric` lists the right-aligned columns. */
function table(headers, rows, { onclick, numeric = [] } = {}) {
  const cls = (i) => (numeric.includes(i) ? "num" : "");
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          headers.map((t, i) => h("th", { class: cls(i) }, t)),
        ),
      ),
      h(
        "tbody",
        {},
        rows.map((cells, r) =>
          h(
            "tr",
            onclick ? { class: "click", onclick: () => onclick(r) } : {},
            cells.map((c, i) => h("td", { class: cls(i) }, c)),
          ),
        ),
      ),
    ),
  );
}

function login(message = "") {
  shell(false);
  const email = h("input", {
    type: "email",
    placeholder: "E-mail",
    required: "",
    autocomplete: "email",
    "aria-label": "E-mail",
  });
  const code = h("input", {
    inputmode: "numeric",
    placeholder: "Código de 6 dígitos",
    maxlength: "6",
    autocomplete: "one-time-code",
    "aria-label": "Código de 6 dígitos",
    hidden: "",
  });
  const note = h("p", { class: "muted error", role: "status" }, message);
  const button = h(
    "button",
    { class: "primary", type: "submit" },
    "Receber código",
  );
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
    h("h1", {}, "Entrar no painel"),
    email,
    code,
    button,
    note,
  );
  app.replaceChildren(form);
}

// Screens

async function overview() {
  const [d, i, events, live] = await Promise.all([
    api("/api/admin/overview"),
    api("/api/admin/insights"),
    api("/api/admin/activity?limit=10"),
    // Presence comes from the social hub; the page still works without it.
    api("/api/admin/live").catch(() => null),
  ]);
  const f = i.funnel;
  const online = live?.online.length ?? d.onlineNow;
  const playing = live?.online.filter((p) => p.playing) ?? [];
  setLive(online);
  const nowLine = online
    ? `${plural(online, "pessoa online", "pessoas online")}, ${playing.length} jogando.`
    : "Ninguém online agora.";
  const step = (label, value) => ({
    label,
    value: `${value} · ${percent(value, f.total)}`,
    share: f.total ? value / f.total : 0,
  });
  app.replaceChildren(
    ...page(
      "Visão geral",
      "O que está acontecendo no OpenRetro agora e como a base vem crescendo.",
    ),
    h(
      "div",
      { class: "now" },
      h(
        "div",
        {},
        h("p", { class: "now-line" }, nowLine),
        playing.length
          ? h(
              "ul",
              { class: "playing" },
              playing
                .slice(0, 6)
                .map((p) =>
                  h(
                    "li",
                    {},
                    h("span", {}, userLink(p), ` joga ${p.playing.title}`),
                    h(
                      "span",
                      {},
                      `${p.playing.console} · ${ago(p.playing.startedAt).replace("há ", "")}`,
                    ),
                  ),
                ),
            )
          : h(
              "p",
              { class: "lead" },
              online
                ? "Ninguém está jogando agora."
                : "Quando alguém abrir o app, aparece aqui.",
            ),
        h(
          "p",
          { class: "lead" },
          h("a", { href: "#/live" }, "Ver quem está online"),
        ),
      ),
      panel(
        "Contas ativas por dia",
        "Últimos 30 dias",
        chart(perDay(i.activePerDay), {
          tone: 1,
          label: "Contas ativas por dia",
        }),
      ),
    ),
    figures([
      figure(d.users, "contas no total"),
      figure(d.active.day, "ativos em 24 h"),
      figure(d.active.week, "ativos em 7 dias"),
      figure(d.signups.week, `cadastros em 7 dias · ${d.signups.day} hoje`),
      figure(d.signups.month, "cadastros em 30 dias"),
      figure(
        d.friendships,
        `amizades · ${d.pendingRequests} pedidos pendentes`,
      ),
      figure(d.parties.week, `Partys em 7 dias · ${d.parties.day} hoje`),
      figure(d.blocks, "bloqueios"),
    ]),
    ...section(
      "Crescimento e uso",
      "Passe o mouse numa coluna para ver o valor do dia.",
    ),
    h(
      "div",
      { class: "panels" },
      panel(
        "Cadastros por dia",
        "Últimos 30 dias",
        chart(perDay(i.signupsPerDay), { tone: 2, label: "Cadastros por dia" }),
      ),
      panel(
        "Partys criadas por dia",
        "Últimos 14 dias",
        chart(perDay(d.partiesPerDay), {
          tone: 3,
          kind: "bar",
          label: "Partys criadas por dia",
        }),
      ),
      panel(
        "Mensagens por dia",
        "Só a contagem, nunca o texto",
        chart(perDay(i.messagesPerDay), {
          tone: 4,
          label: "Mensagens por dia",
        }),
      ),
    ),
    ...section(
      "Da conta ao jogo",
      "Quantas pessoas chegam a cada passo, em relação a todas as contas.",
    ),
    meter([
      { label: "Criaram a conta", value: String(f.total), share: 1 },
      step("Escolheram um nome", f.named),
      step("Têm pelo menos 1 amigo", f.withFriend),
      step("Já jogaram algum jogo", f.played),
      step("Já criaram um Party", f.hosted),
    ]),
    ...section("Atividade recente"),
    events.events.length
      ? h("ul", { class: "events" }, events.events.map(eventRow))
      : empty("Nada registrado ainda. Os eventos aparecem a partir do deploy."),
    h(
      "p",
      { class: "muted" },
      `${d.parties.total} Partys registradas desde que o painel começou a contar.`,
    ),
  );
}

async function liveView() {
  const list = h("div");
  const stamp = h("span");
  async function load() {
    const d = await api("/api/admin/live");
    const byId = new Map(d.online.map((p) => [p.id, p]));
    const playing = d.online.filter((p) => p.playing).length;
    setLive(d.online.length);
    list.replaceChildren(
      figures([
        figure(d.online.length + (d.more ? "+" : ""), "online agora"),
        figure(playing, "jogando"),
        figure(d.parties.length, "Partys com jogadores"),
        figure(
          d.parties.reduce((n, p) => n + p.members.length, 0),
          "jogadores em Party",
        ),
      ]),
      ...section(
        "Partys ao vivo",
        "Convidados por link, sem conta, não aparecem aqui.",
      ),
      d.parties.length
        ? h(
            "div",
            { class: "panels" },
            d.parties.map((party, i) =>
              panel(
                `Party ${i + 1}`,
                plural(party.members.length, "jogador", "jogadores"),
                h(
                  "ul",
                  { class: "plain" },
                  party.members.map((id) => {
                    const p = byId.get(id);
                    return h(
                      "li",
                      {},
                      userLink(p),
                      p?.playing
                        ? h("span", { class: "muted" }, ` · ${p.playing.title}`)
                        : null,
                    );
                  }),
                ),
              ),
            ),
          )
        : empty("Nenhuma Party com jogadores logados agora."),
      ...section(
        "Quem está online",
        "O jogo só aparece se a pessoa deixa o app mostrar. Quem fica invisível aparece sem ele.",
      ),
      d.online.length
        ? table(
            ["Nome", "Jogando", "Party", "Visto"],
            d.online.map((p) => [
              who(p, true),
              p.playing
                ? `${p.playing.title} · ${p.playing.console}`
                : p.status === "idle"
                  ? "Ausente"
                  : "—",
              p.party
                ? `Party ${d.parties.findIndex((x) => x.room === p.party) + 1}`
                : "—",
              ago(p.seenAt),
            ]),
            { onclick: (i) => (location.hash = `#/users/${d.online[i].id}`) },
          )
        : empty("Ninguém online agora."),
    );
    stamp.textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}`;
  }
  app.replaceChildren(
    ...page("Ao vivo", "Quem está com o app aberto neste momento."),
    h("p", { class: "muted" }, stamp, " · atualiza sozinho a cada 15 segundos"),
    list,
  );
  await load();
  refresh = setInterval(() => load().catch(fail), 15000);
}

async function users() {
  const search = h("input", {
    type: "search",
    placeholder: "Buscar por nome, código de amigo ou e-mail",
    "aria-label": "Buscar usuários",
  });
  const option = ([value, label]) => h("option", { value }, label);
  const sort = h(
    "select",
    { "aria-label": "Ordenar por" },
    [
      ["recent", "Mais novos"],
      ["seen", "Visto por último"],
      ["friends", "Mais amigos"],
      ["played", "Mais tempo jogado"],
    ].map(option),
  );
  const filter = h(
    "select",
    { "aria-label": "Filtrar" },
    [
      ["", "Todos"],
      ["online", "Online agora"],
      ["nofriends", "Sem amigos"],
      ["noprofile", "Sem nome escolhido"],
    ].map(option),
  );
  const body = h("tbody");
  const more = h(
    "button",
    { class: "ghost more", type: "button", hidden: "" },
    "Carregar mais",
  );
  const status = h("p", { class: "muted" });
  let offset = 0;
  async function load(reset) {
    if (reset) {
      offset = 0;
      body.replaceChildren();
    }
    const q = new URLSearchParams({
      q: search.value.trim(),
      sort: sort.value,
      filter: filter.value,
      offset,
    });
    const data = await api(`/api/admin/users?${q}`);
    offset += data.users.length;
    for (const u of data.users)
      body.append(
        h(
          "tr",
          {
            class: "click",
            onclick: () => (location.hash = `#/users/${u.id}`),
          },
          h("td", {}, who(u, u.online)),
          h("td", {}, u.friendCode),
          h("td", {}, u.email),
          h("td", {}, when(u.createdAt)),
          h("td", {}, u.online ? "agora" : ago(u.lastSeenAt)),
          h("td", { class: "num" }, String(u.friends)),
          h("td", { class: "num" }, u.playSeconds ? hours(u.playSeconds) : "—"),
        ),
      );
    status.textContent = offset
      ? ""
      : "Nenhuma conta encontrada. Tente outro nome ou limpe o filtro.";
    more.hidden = !data.more;
  }
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(true).catch(fail), 250);
  });
  for (const select of [sort, filter])
    select.addEventListener("change", () => load(true).catch(fail));
  more.addEventListener("click", () => load(false).catch(fail));
  app.replaceChildren(
    ...page(
      "Usuários",
      "Todas as contas. Clique numa linha para ver amigos, jogos e histórico.",
    ),
    h("div", { class: "toolbar" }, search, sort, filter),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            ["Nome", "Código", "E-mail", "Cadastro", "Visto"].map((t) =>
              h("th", {}, t),
            ),
            ["Amigos", "Jogou"].map((t) => h("th", { class: "num" }, t)),
          ),
        ),
        body,
      ),
    ),
    status,
    more,
  );
  await load(true);
}

/** The account in the middle, its friends around it, and a line between friends who know each other. */
function graph(user, friends, edges) {
  if (!friends.length) return empty("Sem amigos para desenhar.");
  const W = 560,
    H = 440,
    cx = W / 2,
    cy = H / 2;
  const shown = friends.slice(0, 60);
  const place = new Map();
  shown.forEach((f, i) => {
    const ring =
      shown.length > 24 && i % 2 ? 100 : shown.length > 24 ? 185 : 165;
    const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
    place.set(f.id, [
      cx + Math.cos(angle) * ring * 1.15,
      cy + Math.sin(angle) * ring,
    ]);
  });
  const lines = shown.map((f) => {
    const [px, py] = place.get(f.id);
    return svg("line", { x1: cx, y1: cy, x2: px, y2: py, class: "edge" });
  });
  for (const e of edges) {
    const a = place.get(e.a),
      b = place.get(e.b);
    if (a && b)
      lines.push(
        svg("line", {
          x1: a[0],
          y1: a[1],
          x2: b[0],
          y2: b[1],
          class: "edge friend",
        }),
      );
  }
  const nodes = shown.map((f) => {
    const [px, py] = place.get(f.id);
    const label = name(f);
    return svg(
      "a",
      { href: `#/users/${f.id}` },
      svg("title", {}, `${label} · ${plural(f.friends, "amigo", "amigos")}`),
      svg("circle", {
        cx: px,
        cy: py,
        r: 6 + Math.min(8, Math.sqrt(f.friends)),
        class: f.online ? "node on" : "node",
      }),
      shown.length <= 30
        ? svg(
            "text",
            { x: px, y: py + 24, "text-anchor": "middle", class: "label" },
            label.length > 14 ? `${label.slice(0, 13)}…` : label,
          )
        : null,
    );
  });
  return h(
    "div",
    { class: "panel" },
    svg(
      "svg",
      { viewBox: `0 0 ${W} ${H}`, class: "graph", role: "img" },
      svg("title", {}, `Amigos de ${name(user)}`),
      ...lines,
      svg("circle", { cx, cy, r: 16, class: "node me" }),
      svg(
        "text",
        { x: cx, y: cy + 34, "text-anchor": "middle", class: "label" },
        name(user),
      ),
      ...nodes,
    ),
    h(
      "p",
      { class: "muted legend" },
      "Linhas finas ligam a pessoa aos amigos; as mais fortes ligam amigos que também são amigos entre si. Âmbar é online. O círculo cresce com o número de amigos de cada um.",
      friends.length > shown.length
        ? ` Mostrando ${shown.length} de ${friends.length}.`
        : "",
    ),
  );
}

const people = (list, extra) =>
  list.length
    ? h(
        "ul",
        { class: "events" },
        list.map((p) => h("li", {}, userLink(p), h("time", {}, extra(p)))),
      )
    : empty("Ninguém.");

async function userPage(id) {
  const d = await api(`/api/admin/users/${id}`);
  const u = d.user;
  const status = [
    u.online
      ? d.presence.playing
        ? `Jogando ${d.presence.playing.title} (${d.presence.playing.console})`
        : "Online"
      : `Visto ${ago(u.lastSeenAt)}`,
    d.presence.inParty ? "em Party" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const column = (title, list) =>
    h(
      "div",
      {},
      ...section(`${title} (${list.length})`),
      people(list, (p) => when(p.at)),
    );
  app.replaceChildren(
    h("a", { class: "back", href: "#/users" }, "Voltar para usuários"),
    h(
      "div",
      { class: "page-head person-head" },
      avatar(u, u.online, true),
      h(
        "div",
        {},
        h("h1", {}, name(u)),
        h("p", {}, `${u.friendCode} · ${status}`),
      ),
    ),
    figures([
      figure(when(u.createdAt), "criou a conta"),
      figure(when(u.lastSeenAt), "último acesso"),
      figure(hours(d.counts.playSeconds), "tempo jogado"),
      figure(d.counts.daysActive, "dias ativo (desde o deploy)"),
      figure(d.counts.parties, "Partys criadas"),
      figure(d.counts.messagesSent, "mensagens enviadas (só a contagem)"),
      figure(u.sessions, "sessões abertas"),
      figure(u.email, "e-mail"),
      figure(
        [
          u.discoverable ? "descobrível" : "oculto",
          u.appearOffline ? "invisível" : "visível",
          u.showPlaying ? "mostra o jogo" : "esconde o jogo",
        ].join(" · "),
        "privacidade",
      ),
      figure(
        `${u.locale} · ${u.emailAlerts ? "avisos ligados" : "avisos desligados"}`,
        "idioma e e-mails",
      ),
    ]),
    ...section(
      `Rede de amigos (${d.friends.length})`,
      "Quem a pessoa conhece e como esses amigos se conhecem.",
    ),
    graph(u, d.friends, d.edges),
    ...section("Amigos"),
    d.friends.length
      ? table(
          ["Nome", "Amigos desde", "Visto", "Amigos"],
          d.friends.map((f) => [
            who(f, f.online),
            when(f.since),
            f.online ? "agora" : ago(f.lastSeenAt),
            String(f.friends),
          ]),
          {
            onclick: (i) => (location.hash = `#/users/${d.friends[i].id}`),
            numeric: [3],
          },
        )
      : empty("Nenhum amigo ainda."),
    h(
      "div",
      { class: "two" },
      column("Pedidos recebidos", d.incoming),
      column("Pedidos enviados", d.outgoing),
      column("Bloqueou", d.blocking),
      column("Foi bloqueado por", d.blockedBy),
    ),
    ...section("Jogos recentes"),
    d.games.length
      ? h(
          "ul",
          { class: "events" },
          d.games.map((g) =>
            h(
              "li",
              {},
              h(
                "span",
                {},
                `${g.title} · ${g.console} · ${hours(g.playSeconds)}`,
              ),
              h("time", {}, when(g.lastPlayedAt)),
            ),
          ),
        )
      : empty("Nada jogado ainda."),
    ...section("Sessões abertas"),
    d.activeSessions.length
      ? h(
          "ul",
          { class: "events" },
          d.activeSessions.map((s) =>
            h(
              "li",
              {},
              h("span", {}, `Entrou em ${when(s.createdAt)}`),
              h("time", {}, `visto ${ago(s.lastSeenAt)}`),
            ),
          ),
        )
      : empty("Nenhuma sessão aberta."),
    ...section("Atividade"),
    d.events.length
      ? h("ul", { class: "events" }, d.events.map(eventRow))
      : empty("Sem eventos registrados."),
  );
}

async function activity() {
  const filter = h(
    "select",
    { "aria-label": "Tipo de evento" },
    FILTERS.map(([value, label]) => h("option", { value }, label)),
  );
  const list = h("ul", { class: "events" });
  const more = h(
    "button",
    { class: "ghost more", type: "button", hidden: "" },
    "Carregar mais",
  );
  const status = h("p", { class: "muted" });
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
    status.textContent = list.children.length
      ? ""
      : "Nenhum evento desse tipo ainda.";
    more.hidden = !data.more;
  }
  filter.addEventListener("change", () => load(true).catch(fail));
  more.addEventListener("click", () => load(false).catch(fail));
  app.replaceChildren(
    ...page(
      "Atividade",
      "Contas criadas, pedidos de amizade, bloqueios e Partys, do mais novo para o mais antigo.",
    ),
    h("div", { class: "toolbar" }, filter),
    list,
    status,
    more,
  );
  await load(true);
}

async function insightsView() {
  const d = await api("/api/admin/insights");
  const peak = (list, key) => Math.max(1, ...list.map((x) => x[key]));
  // Names in a ranking open the profile.
  const ranked = (list, key, text) =>
    list.length
      ? meter(
          list.map((p) => ({
            label: userLink(p),
            value: text(p),
            share: p[key] / peak(list, key),
          })),
        )
      : empty("Nada por aqui.");
  const hasHours = d.onlineByHour.some(Boolean);
  app.replaceChildren(
    ...page(
      "Insights",
      "Quando as pessoas aparecem, o que jogam e onde vale prestar atenção.",
    ),
    ...section(
      "Quando as pessoas estão online",
      "O servidor conta quantas contas estão online uma vez por hora.",
    ),
    hasHours
      ? h(
          "div",
          { class: "panels" },
          panel(
            "Média por hora do dia",
            "Horário de Brasília",
            chart(
              d.onlineByHour.map((value, hour) => ({
                label: `${hour}h`,
                value: Math.round(value * 10) / 10,
              })),
              { tone: 1, kind: "bar", label: "Média online por hora do dia" },
            ),
          ),
          panel(
            "Nas últimas horas",
            "Uma amostra por hora",
            chart(
              d.onlineSamples.map((s) => ({
                label: `${new Date(s.at).getHours()}h`,
                value: s.online,
              })),
              { tone: 2, label: "Online nas últimas horas" },
            ),
          ),
        )
      : empty(
          "Ainda sem amostras. Elas começam a chegar na primeira hora depois do deploy.",
        ),
    ...section("Jogos"),
    h(
      "div",
      { class: "two" },
      d.topGames.length
        ? meter(
            d.topGames.map((g) => ({
              label: `${g.title} · ${g.console}`,
              value: plural(g.players, "jogador", "jogadores"),
              share: g.players / peak(d.topGames, "players"),
              note: `${hours(g.seconds)} no total`,
            })),
          )
        : empty("Ninguém jogou ainda."),
      d.topConsoles.length
        ? meter(
            d.topConsoles.map((c) => ({
              label: c.console,
              value: plural(c.players, "jogador", "jogadores"),
              share: c.players / peak(d.topConsoles, "players"),
              note: `${hours(c.seconds)} no total`,
            })),
          )
        : null,
    ),
    ...section("Quem mais joga"),
    ranked(d.topPlayers, "seconds", (p) => hours(p.seconds)),
    ...section(
      "Social",
      "Quantos amigos as pessoas têm e quanto dos pedidos viram amizade.",
    ),
    h(
      "div",
      { class: "two" },
      meter(
        d.friendBuckets.map((b) => ({
          label: b.bucket === "0" ? "Nenhum amigo" : `${b.bucket} amigos`,
          value: String(b.users),
          share: b.users / peak(d.friendBuckets, "users"),
        })),
      ),
      figures([
        figure(
          d.acceptRate == null ? "—" : `${Math.round(d.acceptRate * 100)}%`,
          "pedidos aceitos nos últimos 30 dias",
        ),
        figure(d.emailAlertsDay, "e-mails de aviso em 24 h"),
      ]),
    ),
    ...section(
      "Mais bloqueados",
      "Muitos bloqueios podem indicar abuso. Confira o perfil antes de concluir qualquer coisa.",
    ),
    ranked(d.mostBlocked, "count", (p) =>
      plural(p.count, "bloqueio", "bloqueios"),
    ),
    ...section(
      "Mais pedidos pendentes enviados",
      "Pedidos que ninguém respondeu. Muitos de uma só conta pode ser spam.",
    ),
    ranked(d.pendingSenders, "count", (p) =>
      plural(p.count, "pendente", "pendentes"),
    ),
  );
}

function fail(error) {
  if (error instanceof Unauthorized) {
    stopRefresh();
    token = null;
    store.set(null);
    return login("Sua sessão expirou. Entre novamente.");
  }
  app.replaceChildren(h("p", { class: "error", role: "alert" }, error.message));
}

async function route() {
  stopRefresh();
  const [first = "", id] = location.hash.replace(/^#\/?/, "").split("/");
  const current = first === "" ? "overview" : first;
  for (const link of nav.querySelectorAll("a"))
    link.classList.toggle("on", link.dataset.route === current);
  app.replaceChildren(h("p", { class: "muted" }, "Carregando…"));
  try {
    if (current === "users" && id) await userPage(id);
    else if (current === "users") await users();
    else if (current === "live") await liveView();
    else if (current === "activity") await activity();
    else if (current === "insights") await insightsView();
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
  shell(true);
  await route();
}

document.getElementById("logout").addEventListener("click", async () => {
  stopRefresh();
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
