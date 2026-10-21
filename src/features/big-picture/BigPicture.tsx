import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Download,
  Gamepad2,
  Heart,
  Home,
  Library,
  MonitorCog,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { DownloadJob, Emulator, LibraryGame } from "../../types";
import { bridge } from "../../services/bridge";
import { GameResolver } from "../../services/GameResolver";
import { platformById } from "../../db/platforms";
import { GameArtwork } from "../../components/GameArtwork";

type Section = "home" | "library" | "downloads" | "emulators" | "system";
const sections: { id: Section; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Início", icon: Home },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "emulators", label: "Emuladores", icon: MonitorCog },
  { id: "system", label: "Configurações", icon: Settings },
];
const activeDownload = (state: string) =>
  ["RESOLVING", "QUEUED", "DOWNLOADING", "VERIFYING"].includes(state);

export function BigPicture({
  library,
  emulators,
  jobs,
  refresh,
  onClose,
  onDesktop,
  notify,
}: {
  library: LibraryGame[];
  emulators: Emulator[];
  jobs: DownloadJob[];
  refresh: () => Promise<void>;
  onClose: () => void;
  onDesktop: (page: "Discover" | "Settings" | "Emulators") => void;
  notify: (message: string) => void;
}) {
  const [section, setSection] = useState<Section>("home");
  const [navFocused, setNavFocused] = useState(false);
  const [selected, setSelected] = useState(0);
  const [launching, setLaunching] = useState(false);
  const held = useRef(new Set<string>());
  const games = useMemo(
    () =>
      [...library].sort((a, b) =>
        (b.item.lastPlayedAt ?? "").localeCompare(a.item.lastPlayedAt ?? ""),
      ),
    [library],
  );
  const selectedGame = games[Math.min(selected, Math.max(games.length - 1, 0))];
  const heroGame = selectedGame ?? games[0];
  const selectSection = (next: Section) => {
    setSection(next);
    setSelected(0);
    setNavFocused(false);
  };
  const move = (amount: number, size: number) =>
    setSelected((current) => (size ? (current + amount + size) % size : 0));
  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    onClose();
  };
  const currentSize = () =>
    section === "downloads"
      ? jobs.length
      : section === "emulators"
        ? emulators.length
        : section === "system"
          ? 4
          : games.length;
  const launch = async (entry = heroGame) => {
    if (!entry || launching) return;
    setLaunching(true);
    try {
      const resolution = await new GameResolver(bridge.exists).resolve(
        entry.game,
        entry.item,
        emulators,
      );
      if (resolution.state !== "READY") throw new Error(resolution.message);
      await bridge.launch(entry.item.id);
    } catch (error) {
      notify(String(error));
    } finally {
      setLaunching(false);
    }
  };
  const favorite = async () => {
    if (!selectedGame) return;
    await bridge.favorite(selectedGame.item.id, !selectedGame.item.favorite);
    await refresh();
  };
  const remove = async () => {
    if (!selectedGame || !confirm(`Remover ${selectedGame.game.title} da biblioteca?`)) return;
    await bridge.removeGame(selectedGame.item.id);
    await refresh();
    setSelected(0);
  };
  const activate = () => {
    if (navFocused) return;
    if (section === "home" || section === "library") return void launch();
    if (section === "downloads") {
      const job = jobs[selected];
      if (job)
        void bridge
          .controlDownload(job.id, activeDownload(job.state) ? "pause" : "resume")
          .then(refresh)
          .catch((error) => notify(String(error)));
      return;
    }
    if (section === "emulators") return onDesktop("Emulators");
    const page = ["Discover", "Settings", "Emulators", "exit"][selected];
    page === "exit" ? close() : onDesktop(page as "Discover" | "Settings" | "Emulators");
  };
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const handle = (key: string) => {
      if (key === "b") return navFocused ? close() : setNavFocused(true);
      if (key === "a") return activate();
      if (key === "left") return navFocused ? move(-1, sections.length) : setNavFocused(true);
      if (key === "right") return navFocused ? setNavFocused(false) : move(1, currentSize());
      if (key === "up") return move(-1, navFocused ? sections.length : currentSize());
      if (key === "down") return move(1, navFocused ? sections.length : currentSize());
      if (key === "x" && !navFocused && (section === "home" || section === "library")) void favorite();
      if (key === "y" && !navFocused && (section === "home" || section === "library")) void remove();
    };
    const onKey = (event: KeyboardEvent) => {
      const keys: Record<string, string> = {
        Escape: "b", Enter: "a", " ": "a", ArrowLeft: "left", ArrowRight: "right",
        ArrowUp: "up", ArrowDown: "down", x: "x", X: "x", y: "y", Y: "y",
      };
      if (keys[event.key]) { event.preventDefault(); handle(keys[event.key]); }
    };
    window.addEventListener("keydown", onKey);
    let frame = 0;
    const poll = () => {
      const pad = navigator.getGamepads?.().find(Boolean);
      if (pad) {
        const active = new Set<string>();
        const edge = (id: string, pressed: boolean) => { if (pressed) active.add(id); return pressed && !held.current.has(id); };
        if (edge("left", Boolean(pad.buttons[14]?.pressed || pad.axes[0] < -0.7))) handle("left");
        if (edge("right", Boolean(pad.buttons[15]?.pressed || pad.axes[0] > 0.7))) handle("right");
        if (edge("up", Boolean(pad.buttons[12]?.pressed || pad.axes[1] < -0.7))) handle("up");
        if (edge("down", Boolean(pad.buttons[13]?.pressed || pad.axes[1] > 0.7))) handle("down");
        if (edge("a", Boolean(pad.buttons[0]?.pressed))) handle("a");
        if (edge("b", Boolean(pad.buttons[1]?.pressed))) handle("b");
        if (edge("x", Boolean(pad.buttons[2]?.pressed))) handle("x");
        if (edge("y", Boolean(pad.buttons[3]?.pressed))) handle("y");
        held.current = active;
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", onKey); };
  });
  useEffect(() => {
    if (navFocused && sections[selected]) {
      setSection(sections[selected].id);
      setSelected(0);
    }
  }, [selected, navFocused]);
  const shelf = (title: string, entries: LibraryGame[]) => (
    <section className="bp-game-shelf">
      <div className="bp-section-title"><h2>{title}</h2><span>{entries.length} jogos</span></div>
      <div className="bp-game-grid">
        {entries.map((entry, index) => (
          <button key={entry.item.id} className={index === selected && !navFocused ? "focused" : ""} onClick={() => { setSelected(index); setNavFocused(false); }} onDoubleClick={() => void launch(entry)}>
            <GameArtwork game={entry.game} />
            <span>{entry.game.title}</span>
            <small>{platformById(entry.game.platformId)?.shortName ?? entry.game.platformId}</small>
          </button>
        ))}
      </div>
    </section>
  );
  const activeJobs = jobs.filter((job) => activeDownload(job.state)).length;
  const heroPlatform = heroGame && (platformById(heroGame.game.platformId)?.name ?? heroGame.game.platformId);
  return (
    <section className="big-picture" aria-label="Modo console do OpenRetro">
      <div className="bp-stage-art" aria-hidden="true">{heroGame && <GameArtwork game={heroGame.game} hero />}</div>
      <div className="bp-stage-wash" />
      <div className="bp-side-rail">
        <button className="bp-profile" title="Perfil"><Gamepad2 size={25} /><i /></button>
        <nav className={`bp-nav ${navFocused ? "focused" : ""}`} aria-label="Navegação principal">
          {sections.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => selectSection(item.id)} aria-label={item.label}>
            <item.icon size={21} /><span>{item.label}</span>{item.id === "downloads" && activeJobs > 0 && <small>{activeJobs}</small>}
          </button>)}
        </nav>
        <div className="bp-rail-bottom"><button onClick={() => setNavFocused(true)} aria-label="Abrir menu"><MoreHorizontal size={22} /></button><button onClick={close} aria-label="Sair do Big Picture"><X size={20} /></button></div>
      </div>
      <header className="bp-topbar"><span><ChevronLeft size={20} /> {section === "home" ? "Início" : sections.find((item) => item.id === section)?.label}</span><div><button aria-label="Pesquisar jogos" onClick={() => onDesktop("Discover")}><Search size={22} /></button><button className="big-picture-exit" onClick={close}>Sair do modo console</button></div></header>
      <main className="bp-content">
        {section === "home" && <>
          <section className="bp-hero" key={heroGame?.item.id ?? "empty"}>
            <div className="bp-hero-copy">
              <p className="bp-kicker">{heroGame?.item.lastPlayedAt ? "Continue jogando" : "Pronto para jogar"}</p>
              <h1>{heroGame?.game.title ?? "Sua coleção começa aqui"}</h1>
              <p className="bp-hero-meta">{heroGame ? `${heroPlatform}  ·  ${heroGame.game.genre || "Jogo"}` : "Importe seus jogos no modo desktop para montar sua biblioteca."}</p>
              {heroGame ? <div className="bp-hero-actions"><button className="bp-play" onClick={() => void launch()}><Play size={19} fill="currentColor" />{launching ? "Iniciando…" : "Jogar"}</button><button className="bp-secondary" onClick={() => void favorite()}><Heart size={18} fill={heroGame.item.favorite ? "currentColor" : "none"} />{heroGame.item.favorite ? "Favorito" : "Favoritar"}</button></div> : <div className="bp-hero-actions"><button className="bp-play" onClick={() => onDesktop("Discover")}><Search size={19} />Encontrar jogos</button></div>}
            </div>
            {heroGame && <div className="bp-hero-stat"><strong>{heroGame.item.playtime ? `${Math.floor(heroGame.item.playtime / 3600)}h` : "Novo"}</strong><span>{heroGame.item.playtime ? "tempo jogado" : "na biblioteca"}</span></div>}
          </section>
          {shelf("Jogados recentemente", games.slice(0, 12))}
        </>}
        {section === "library" && <><div className="bp-library-head"><div><h1>Sua biblioteca</h1><p>{games.length ? `${games.length} jogos prontos para a próxima sessão.` : "Sua biblioteca ainda está vazia."}</p></div><button onClick={() => onDesktop("Discover")}><Search size={19} /> Encontrar jogos</button></div>{shelf("Todos os jogos", games)}</>}
        {section === "downloads" && <section className="bp-panel"><div className="bp-section-title"><div><h1>Downloads</h1><p>O que está acontecendo agora.</p></div><span>{activeJobs} ativos</span></div>{jobs.length ? <div className="bp-list">{jobs.map((job, index) => <article key={job.id} className={index === selected && !navFocused ? "focused" : ""} onClick={() => { setSelected(index); setNavFocused(false); }}><Download size={22} /><div><strong>{job.name}</strong><span>{job.state} · {job.progress.toFixed(0)}%</span><progress value={job.progress} max="100" /></div><button title="Pausar ou retomar" onClick={() => void bridge.controlDownload(job.id, activeDownload(job.state) ? "pause" : "resume").then(refresh)}>{activeDownload(job.state) ? <Pause size={18} /> : <Play size={18} />}</button><button title="Remover download" onClick={() => void bridge.removeDownload(job.id).then(refresh)}><Trash2 size={18} /></button></article>)}</div> : <p className="bp-empty">Não há downloads em andamento.</p>}</section>}
        {section === "emulators" && <section className="bp-panel"><div className="bp-section-title"><div><h1>Emuladores</h1><p>Configure uma vez. Jogue da biblioteca.</p></div><span>{emulators.length} configurados</span></div><div className="bp-emulator-grid">{emulators.map((emulator, index) => <button className={index === selected && !navFocused ? "focused" : ""} key={emulator.id} onClick={() => onDesktop("Emulators")}><MonitorCog size={28} /><strong>{emulator.name}</strong><span>{emulator.supportedPlatforms.map((id) => platformById(id)?.shortName ?? id).join(" · ")}</span></button>)}</div><button className="bp-wide-action" onClick={() => onDesktop("Emulators")}>Gerenciar emuladores</button></section>}
        {section === "system" && <section className="bp-panel"><div className="bp-section-title"><div><h1>Sistema</h1><p>Ferramentas do OpenRetro.</p></div></div><div className="bp-system-grid">{[["Encontrar jogos", "Descubra títulos e fontes", "Discover"], ["Configurações", "Ajuste a experiência", "Settings"], ["Gerenciar emuladores", "Revise sistemas e cores", "Emulators"], ["Sair do modo console", "Voltar para o modo desktop", "exit"]].map(([label, description, page], index) => <button key={label} className={index === selected && !navFocused ? "focused" : ""} onClick={() => page === "exit" ? close() : onDesktop(page as "Discover" | "Settings" | "Emulators")}><Settings size={25} /><strong>{label}</strong><span>{description}</span></button>)}</div></section>}
      </main>
      <footer className="bp-controls"><span><b>A</b> Selecionar</span><span><b>B</b> Menu</span><span><b>X</b> Favoritar</span><span><b>Y</b> Remover</span><span><b>← ↑ ↓ →</b> Navegar</span></footer>
    </section>
  );
}
