import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleHelp,
  Download,
  ExternalLink,
  FileUp,
  Languages,
  Layers,
  LoaderCircle,
  Search,
  Settings2,
  Trash2,
  XCircle,
} from "lucide-react";
import type {
  GameMetadata,
  GameVariant,
  LibraryGame,
  LocalPatchInfo,
  ModCompatibility,
  ModInstallRequest,
  ModJob,
  ModListing,
} from "../../types";
import { Modal } from "../../components/Modal";
import { isDesktop } from "../../services/bridge";
import {
  compatibilityLabels,
  formatBytes,
  installTargets,
  jobRunning,
  kindLabels,
  languageLabel,
  mods,
  PATCH_FORMATS,
} from "../../services/mods";
import { t } from "../../i18n";

/** Requests by job, so a job that stops to ask a question can continue after a remount. */
const requests = new Map<string, ModInstallRequest>();

function CompatibilityBadge({
  compatibility,
}: {
  compatibility?: ModCompatibility | null;
}) {
  if (!compatibility)
    return (
      <span className="mod-badge" data-status="unknown">
        <CircleHelp size={13} />{" "}
        {isDesktop
          ? t("Adicione o jogo para verificar")
          : t("Verificado no aplicativo")}
      </span>
    );
  const Icon =
    compatibility.status === "confirmed"
      ? CheckCircle2
      : compatibility.status === "incompatible"
        ? XCircle
        : CircleHelp;
  return (
    <span
      className="mod-badge"
      data-status={compatibility.status}
      title={compatibility.reason}
    >
      <Icon size={13} /> {compatibilityLabels[compatibility.status]}
    </span>
  );
}

function variantLabel(variants: GameVariant[], id: string | null) {
  return id === null
    ? t("Jogo original")
    : (variants.find((v) => v.id === id)?.name ?? t("Versão instalada"));
}

export function ModsTab({
  game,
  entry,
  running,
  notify,
  refresh,
}: {
  game: GameMetadata;
  entry?: LibraryGame;
  running: boolean;
  notify: (message: string) => void;
  refresh: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const itemId = entry?.item.id ?? null;
  const overviewKey = ["mods", itemId, game.title, game.platformId];
  const overview = useQuery({
    queryKey: overviewKey,
    queryFn: () => mods.overview(itemId, game.title, game.platformId),
    staleTime: 60_000,
  });
  const [jobs, setJobs] = useState<ModJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [plazaInput, setPlazaInput] = useState(game.title);
  const [plazaQuery, setPlazaQuery] = useState<string>();
  const [confirm, setConfirm] = useState<{
    listing: ModListing;
    parent: string | null;
  }>();
  const [local, setLocal] = useState(false);
  const [sources, setSources] = useState(false);
  const [removing, setRemoving] = useState<GameVariant>();
  const plaza = useQuery({
    queryKey: ["mods-plaza", itemId, plazaQuery, game.platformId],
    queryFn: () => mods.searchPlaza(itemId, plazaQuery!, game.platformId),
    enabled: Boolean(plazaQuery),
    retry: false,
    staleTime: 15 * 60_000,
  });

  useEffect(() => {
    let active = true;
    void mods.jobs().then((list) => active && setJobs(list));
    const stop = mods.onJob((job) => {
      setJobs((list) => [job, ...list.filter((j) => j.id !== job.id)]);
      if (job.state === "COMPLETED") {
        void queryClient.invalidateQueries({ queryKey: ["mods"] });
        void refresh();
      }
    });
    return () => {
      active = false;
      stop();
    };
  }, [queryClient, refresh]);

  const data = overview.data;
  const variants = data?.variants ?? [];
  const activeId = data?.activeVariantId ?? null;
  const myJobs = jobs.filter((job) => job.libraryItemId === itemId);
  const installing = myJobs.some(jobRunning);

  async function act(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    try {
      await fn();
      if (message) notify(message);
      await queryClient.invalidateQueries({ queryKey: ["mods"] });
      await refresh();
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function start(request: ModInstallRequest, retryOf?: string) {
    await act(async () => {
      const id = await mods.install(request, retryOf);
      requests.set(id, request);
    });
  }
  function install(
    listing: ModListing,
    parent: string | null,
    confirmed = false,
  ) {
    if (!entry) return;
    const status = listing.compatibility?.status;
    if (status === "unknown" && !confirmed) {
      setConfirm({ listing, parent });
      return;
    }
    void start({
      libraryItemId: entry.item.id,
      parentVariantId: parent,
      origin: listing.sourceId === "romhackplaza" ? "romhackplaza" : "catalog",
      sourceId: listing.sourceId,
      entryId: listing.entry.id,
      name: listing.entry.title,
      confirmUnknown: confirmed,
    });
  }

  function searchPlaza() {
    if (!data?.plazaConfigured) return setSources(true);
    const query = plazaInput.trim();
    if (!query) return;
    if (query === plazaQuery) void plaza.refetch();
    setPlazaQuery(query);
  }

  return (
    <div className="mods-tab">
      {!entry && (
        <p className="hint">
          {t(
            "Você ainda não tem este jogo na biblioteca. Dá para pesquisar e ver os detalhes de cada tradução ou mod; para instalar, adicione o jogo (a compatibilidade é conferida pelo arquivo).",
          )}
        </p>
      )}
      {entry && (
        <section className="mods-section">
          <div className="mods-heading">
            <h2>{t("Versão para jogar")}</h2>
            <small>{t("Jogar e Jogar online usam a versão escolhida.")}</small>
          </div>
          <div className="variant-list">
            <div
              className="variant-row"
              data-active={activeId === null || undefined}
            >
              <div>
                <strong>{t("Jogo original")}</strong>
                <small>
                  {t("Seu arquivo, nunca alterado · SHA-256")}{" "}
                  {entry.item.sha256.slice(0, 12)}…
                </small>
              </div>
              <button
                className="button secondary"
                disabled={busy || running || activeId === null}
                onClick={() =>
                  void act(
                    () => mods.select(entry.item.id, null),
                    t("O jogo original será usado ao jogar."),
                  )
                }
              >
                {activeId === null ? t("Em uso") : t("Usar o original")}
              </button>
            </div>
            {variants.map((variant) => (
              <div
                className="variant-row"
                key={variant.id}
                data-active={activeId === variant.id || undefined}
              >
                <div>
                  <strong>
                    {variant.name}
                    {variant.version ? ` ${variant.version}` : ""}
                  </strong>
                  <small>
                    {[
                      kindLabels[variant.kind],
                      variant.language && languageLabel(variant.language),
                      variant.authors.length
                        ? t("por {authors}", {
                            authors: variant.authors.join(", "),
                          })
                        : null,
                      variant.parentId
                        ? t("sobre {base}", {
                            base: variantLabel(variants, variant.parentId),
                          })
                        : null,
                      variant.format,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  <small>
                    {variant.saves === "shared"
                      ? t(
                          "Usa os saves do original (o autor confirmou que são compatíveis); estados salvos ficam separados.",
                        )
                      : t("Saves e estados salvos separados do original.")}
                    {variant.compatibility === "unknown"
                      ? t(" Instalada sem compatibilidade confirmada.")
                      : ""}
                  </small>
                  {variant.sourceUrl && (
                    <a
                      className="metadata-source"
                      href={variant.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {variant.sourceName} <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <div className="variant-actions">
                  <button
                    className="button primary"
                    disabled={busy || running || activeId === variant.id}
                    onClick={() =>
                      void act(
                        () => mods.select(entry.item.id, variant.id),
                        t("“{name}” será usada ao jogar.", {
                          name: variant.name,
                        }),
                      )
                    }
                  >
                    {activeId === variant.id
                      ? t("Em uso")
                      : t("Usar esta versão")}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t("Remover {name}", { name: variant.name })}
                    title={t("Remover esta versão")}
                    disabled={busy || running}
                    onClick={() => setRemoving(variant)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {myJobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          busy={busy}
          onCancel={() => void act(() => mods.cancel(job.id))}
          onDismiss={() =>
            void act(async () => {
              await mods.dismiss(job.id);
              requests.delete(job.id);
              setJobs((list) => list.filter((j) => j.id !== job.id));
            })
          }
          onRetry={(change) => {
            const request = requests.get(job.id);
            if (!request)
              return notify(
                t("Abra a modificação de novo na lista para tentar outra vez."),
              );
            void start({ ...request, ...change }, job.id);
          }}
        />
      ))}

      <div className="mods-toolbar">
        {entry && isDesktop && (
          <button
            className="button secondary"
            disabled={busy || installing || Boolean(data?.unpatchable)}
            onClick={() => setLocal(true)}
          >
            <FileUp size={16} /> {t("Importar patch local")}
          </button>
        )}

        {isDesktop && (
          <button className="text-button" onClick={() => setSources(true)}>
            <Settings2 size={14} /> {t("Fontes")}
          </button>
        )}
      </div>
      {data?.unpatchable && (
        <p className="hint">
          {data.unpatchable} {t("OpenRetro aplica patches")}{" "}
          {PATCH_FORMATS.join(", ")}{" "}
          {t(
            "em jogos de um único arquivo; outros tipos de mod precisam de suporte específico.",
          )}
        </p>
      )}
      {!isDesktop && (
        <p className="hint">
          {t(
            "Instalar modificações exige o aplicativo OpenRetro no computador.",
          )}
        </p>
      )}

      {overview.isLoading ? (
        <div className="catalog-loading">
          <LoaderCircle className="spin" size={22} />
          <p>{t("Conferindo seu arquivo e o catálogo…")}</p>
        </div>
      ) : overview.error ? (
        <p className="error-message">{String(overview.error)}</p>
      ) : (
        <ListingSection
          title={t("Do catálogo")}
          listings={data?.listings ?? []}
          variants={variants}
          canInstall={Boolean(entry) && isDesktop && !installing && !busy}
          hasGame={Boolean(entry)}
          empty={
            entry
              ? t(
                  "Nenhuma tradução ou mod deste jogo nas suas fontes. Você pode importar um patch que já tenha.",
                )
              : t("Nenhuma tradução ou mod deste jogo nas suas fontes.")
          }
          onInstall={install}
        />
      )}
      {isDesktop && (
        <form
          className="mods-search"
          onSubmit={(event) => {
            event.preventDefault();
            searchPlaza();
          }}
        >
          <div className="download-option-search">
            <Search size={17} />
            <input
              aria-label={t("Pesquisar no Romhack Plaza")}
              value={plazaInput}
              maxLength={200}
              onChange={(event) => setPlazaInput(event.target.value)}
              placeholder={t("Nome do jogo, da tradução ou do romhack")}
            />
          </div>
          <button
            className="button secondary"
            type="submit"
            disabled={plaza.isFetching}
          >
            {t("Buscar no Romhack Plaza")}
          </button>
        </form>
      )}
      {plazaQuery &&
        (plaza.isFetching ? (
          <div className="catalog-loading">
            <LoaderCircle className="spin" size={22} />
            <p>{t("Buscando no Romhack Plaza…")}</p>
          </div>
        ) : plaza.error ? (
          <p className="error-message">{String(plaza.error)}</p>
        ) : (
          <ListingSection
            title={`Romhack Plaza: "${plazaQuery}"`}
            listings={plaza.data ?? []}
            variants={variants}
            canInstall={Boolean(entry) && isDesktop && !installing && !busy}
            hasGame={Boolean(entry)}
            empty={t(
              "Nenhuma tradução ou romhack encontrado. Tente outro nome, como o título original ou em inglês.",
            )}
            onInstall={install}
          />
        ))}

      {confirm && (
        <Modal
          title={t("Compatibilidade desconhecida")}
          onClose={() => setConfirm(undefined)}
        >
          <p className="muted">{confirm.listing.compatibility?.reason}</p>
          <p className="muted">
            {t(
              "A instalação cria uma cópia; seu arquivo original e seus saves não mudam. Se o patch não servir, a cópia não é registrada e nada fica para trás. A nova versão terá saves separados.",
            )}
          </p>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setConfirm(undefined)}
            >
              {t("Cancelar")}
            </button>
            <button
              className="button primary"
              onClick={() => {
                install(confirm.listing, confirm.parent, true);
                setConfirm(undefined);
              }}
            >
              {t("Instalar assim mesmo")}
            </button>
          </div>
        </Modal>
      )}
      {removing && entry && (
        <Modal
          title={t("Remover esta versão?")}
          onClose={() => setRemoving(undefined)}
        >
          <p className="muted">
            {t("A cópia modificada de")} {removing.name}{" "}
            {t(
              "e os saves dela serão apagados. O jogo original e os saves dele continuam como estão.",
            )}
            {variants.some((v) => v.parentId === removing.id)
              ? t(" Versões instaladas sobre esta também serão removidas.")
              : ""}
          </p>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setRemoving(undefined)}
            >
              {t("Manter")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await mods.remove(removing.id);
                  setRemoving(undefined);
                }, t("Versão removida. O jogo original continua intacto."))
              }
            >
              {t("Remover versão")}
            </button>
          </div>
        </Modal>
      )}
      {local && entry && (
        <LocalImport
          entry={entry}
          variants={variants}
          onClose={() => setLocal(false)}
          onInstall={(request) => {
            setLocal(false);
            void start(request);
          }}
          notify={notify}
        />
      )}
      {sources && (
        <SourcesDialog
          configured={Boolean(data?.plazaConfigured)}
          onClose={() => setSources(false)}
          onChanged={() =>
            void queryClient.invalidateQueries({ queryKey: ["mods"] })
          }
          notify={notify}
        />
      )}
    </div>
  );
}

function JobCard({
  job,
  busy,
  onCancel,
  onDismiss,
  onRetry,
}: {
  job: ModJob;
  busy: boolean;
  onCancel: () => void;
  onDismiss: () => void;
  onRetry: (change: Partial<ModInstallRequest>) => void;
}) {
  const [choice, setChoice] = useState("");
  const done = !jobRunning(job);
  return (
    <div className="mod-job" data-state={job.state}>
      <div className="mod-job-head">
        <strong>{job.name}</strong>
        <span>
          {jobRunning(job) && <LoaderCircle className="spin" size={13} />}{" "}
          {job.stage}
        </span>
      </div>
      {jobRunning(job) && (
        <progress
          aria-label={t("Progresso de {name}", { name: job.name })}
          value={job.progress}
          max={100}
        />
      )}
      {job.error && <p className="error-message">{job.error}</p>}
      {job.state === "NEEDS_CHOICE" && (
        <label>
          {job.choiceKind === "file"
            ? t("Este item tem vários arquivos. Qual baixar?")
            : t(
                "O pacote tem vários patches. Qual instalar? Não combine patches sem as instruções do autor.",
              )}
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{t("Escolha…")}</option>
            {job.choices.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mod-job-actions">
        {jobRunning(job) ? (
          <button
            className="button secondary"
            disabled={busy}
            onClick={onCancel}
          >
            {t("Cancelar")}
          </button>
        ) : (
          <>
            {job.state === "NEEDS_CHOICE" && (
              <button
                className="button primary"
                disabled={!choice || busy}
                onClick={() =>
                  onRetry(
                    job.choiceKind === "file"
                      ? { downloadFile: choice }
                      : { archivePath: choice },
                  )
                }
              >
                {t("Continuar")}
              </button>
            )}
            {job.state === "FAILED" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => onRetry({})}
              >
                {t("Tentar de novo")}
              </button>
            )}
            {done && (
              <button className="text-button" onClick={onDismiss}>
                {t("Fechar")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ListingSection({
  title,
  listings,
  variants,
  canInstall,
  hasGame,
  empty,
  onInstall,
}: {
  title: string;
  listings: ModListing[];
  variants: GameVariant[];
  canInstall: boolean;
  hasGame: boolean;
  empty: string;
  onInstall: (listing: ModListing, parent: string | null) => void;
}) {
  return (
    <section className="mods-section">
      <div className="mods-heading">
        <h2>{title}</h2>
      </div>
      {listings.length ? (
        <div className="mod-list">
          {listings.map((listing) => (
            <ModCard
              key={`${listing.sourceId}-${listing.entry.id}`}
              listing={listing}
              variants={variants}
              canInstall={canInstall}
              hasGame={hasGame}
              onInstall={onInstall}
            />
          ))}
        </div>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  );
}

function ModCard({
  listing,
  variants,
  canInstall,
  hasGame,
  onInstall,
}: {
  listing: ModListing;
  variants: GameVariant[];
  canInstall: boolean;
  hasGame: boolean;
  onInstall: (listing: ModListing, parent: string | null) => void;
}) {
  const { entry } = listing;
  const [image, setImage] = useState(0);
  const targets = installTargets(listing);
  const [target, setTarget] = useState<string | null>(targets[0] ?? null);
  const installed = Boolean(listing.installedVariantId);
  const edition = [entry.game.region, entry.game.revision]
    .filter(Boolean)
    .join(", ");
  return (
    <article className="mod-card">
      {entry.images.length > 0 && (
        <div className="mod-images">
          <img
            src={entry.images[image]}
            alt={t("Imagem de {title}", { title: entry.title })}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          {entry.images.length > 1 && (
            <div className="mod-thumbs">
              {entry.images.map((src, i) => (
                <button
                  key={src}
                  aria-label={t("Imagem {number}", { number: i + 1 })}
                  data-selected={i === image || undefined}
                  onClick={() => setImage(i)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mod-body">
        <div className="mod-title">
          <h3>{entry.title}</h3>
          <CompatibilityBadge compatibility={listing.compatibility} />
        </div>
        <p className="mod-meta">
          <span>
            {entry.kind === "translation" ? (
              <Languages size={13} />
            ) : (
              <Layers size={13} />
            )}{" "}
            {kindLabels[entry.kind]}
          </span>
          <span>{languageLabel(entry.language)}</span>
          <span>
            {t("Versão")} {entry.version}
          </span>
          <span>
            {t("por")} {entry.authors.join(", ")}
          </span>
          {entry.patch.format && (
            <span>{entry.patch.format.toUpperCase()}</span>
          )}
          {entry.patch.size ? (
            <span>
              {t("Download de")} {formatBytes(entry.patch.size)}
            </span>
          ) : null}
        </p>
        {entry.description && (
          <p className="mod-description">{entry.description}</p>
        )}
        {listing.compatibility &&
          listing.compatibility.status !== "confirmed" && (
            <p className="mod-reason">{listing.compatibility.reason}</p>
          )}
        {listing.compatibility?.stripHeader && (
          <p className="mod-reason">{listing.compatibility.reason}</p>
        )}
        <details className="mod-details">
          <summary>{t("Requisitos e créditos")}</summary>
          <dl>
            <dt>{t("Jogo")}</dt>
            <dd>
              {entry.game.title}
              {edition ? ` (${edition})` : ""}
            </dd>
            {entry.requirements.length > 0 && (
              <>
                <dt>{t("Requisitos")}</dt>
                <dd>
                  <ul>
                    {entry.requirements.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {entry.credits.length > 0 && (
              <>
                <dt>{t("Créditos")}</dt>
                <dd>
                  <ul>
                    {entry.credits.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {entry.license && (
              <>
                <dt>{t("Licença")}</dt>
                <dd>{entry.license}</dd>
              </>
            )}
            <dt>{t("Saves")}</dt>
            <dd>
              {entry.saves === "shared"
                ? t("O autor confirma que os saves do original funcionam.")
                : t(
                    "Separados do original: compatibilidade não confirmada pelo autor.",
                  )}
            </dd>
            <dt>{t("Fonte")}</dt>
            <dd>{listing.sourceName}</dd>
          </dl>
        </details>
        <div className="mod-actions">
          <a
            className="button outline"
            href={entry.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} /> {t("Página do autor")}
          </a>
          {installed ? (
            <span className="mod-badge" data-status="confirmed">
              <CheckCircle2 size={13} /> {t("Instalada")}
            </span>
          ) : entry.distribution === "link" ? (
            <span className="hint">
              {t(
                'O autor distribui só pela página dele: baixe lá e use "Importar patch local".',
              )}
            </span>
          ) : !hasGame ? (
            <span className="hint">
              {t("Adicione o jogo à biblioteca para instalar.")}
            </span>
          ) : canInstall && targets.length ? (
            <>
              {targets.length > 1 && (
                <select
                  aria-label={t("Instalar sobre")}
                  value={target ?? ""}
                  onChange={(e) => setTarget(e.target.value || null)}
                >
                  {targets.map((option) => (
                    <option key={option ?? "original"} value={option ?? ""}>
                      {t("Sobre:")} {variantLabel(variants, option)}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="button primary"
                onClick={() => onInstall(listing, target)}
              >
                <Download size={15} /> {t("Instalar")}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function LocalImport({
  entry,
  variants,
  onClose,
  onInstall,
  notify,
}: {
  entry: LibraryGame;
  variants: GameVariant[];
  onClose: () => void;
  onInstall: (request: ModInstallRequest) => void;
  notify: (message: string) => void;
}) {
  const [path, setPath] = useState<string>();
  const [archivePath, setArchivePath] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [info, setInfo] = useState<LocalPatchInfo>();
  const [name, setName] = useState("");
  const [acceptUnknown, setAcceptUnknown] = useState(false);
  const [acceptStack, setAcceptStack] = useState(false);
  const [checking, setChecking] = useState(false);
  async function inspect(
    file: string,
    inner: string | null,
    base: string | null,
  ) {
    setChecking(true);
    try {
      const result = await mods.inspectPatch(entry.item.id, base, file, inner);
      setInfo(result);
      if (result.name && !name)
        setName(result.name.replace(/^.*\//, "").replace(/\.[^.]+$/, ""));
    } catch (error) {
      notify(String(error));
      setInfo(undefined);
    } finally {
      setChecking(false);
    }
  }
  const status = info?.compatibility?.status;
  const ready =
    Boolean(path && info?.info) &&
    status !== "incompatible" &&
    (status !== "unknown" || acceptUnknown) &&
    (parent === null || acceptStack);
  return (
    <Modal title={t("Importar patch local")} onClose={onClose}>
      <div className="form-stack">
        <p className="muted">
          {t("Escolha um patch")} {PATCH_FORMATS.join(", ")}
          {t(
            ", ou um .zip/.7z que o contenha. Só o patch é lido do pacote; nada dele é executado. O OpenRetro aplica em uma cópia e mantém seu arquivo original.",
          )}
        </p>
        <button
          className="button secondary"
          disabled={checking}
          onClick={() =>
            void (async () => {
              const picked = await mods.pickPatch().catch((e) => {
                notify(String(e));
                return null;
              });
              if (!picked) return;
              setPath(picked);
              setArchivePath(null);
              setName("");
              await inspect(picked, null, parent);
            })()
          }
        >
          <FileUp size={16} />{" "}
          {path ? t("Escolher outro arquivo") : t("Escolher arquivo")}
        </button>
        {path && <code className="hash">{path}</code>}
        {checking && (
          <p className="muted">
            <LoaderCircle className="spin" size={14} />{" "}
            {t("Lendo o patch e conferindo seu jogo…")}
          </p>
        )}
        {info?.choices.length ? (
          <label>
            {t("O pacote tem vários patches. Escolha um:")}
            <select
              value={archivePath ?? ""}
              onChange={(e) => {
                setArchivePath(e.target.value || null);
                if (e.target.value && path)
                  void inspect(path, e.target.value, parent);
              }}
            >
              <option value="">{t("Escolha…")}</option>
              {info.choices.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {variants.length > 0 && (
          <label>
            {t("Aplicar sobre")}
            <select
              value={parent ?? ""}
              onChange={(e) => {
                const value = e.target.value || null;
                setParent(value);
                setAcceptStack(false);
                if (path) void inspect(path, archivePath, value);
              }}
            >
              <option value="">{t("Jogo original")}</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {info?.info && (
          <div className="local-patch-info">
            <p>
              <strong>{info.info.format?.toUpperCase()}</strong>
              {info.name ? ` · ${info.name}` : ""}
            </p>
            <CompatibilityBadge compatibility={info.compatibility} />
            {info.compatibility?.reason && (
              <p className="mod-reason">{info.compatibility.reason}</p>
            )}
          </div>
        )}
        {status === "unknown" && (
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={acceptUnknown}
              onChange={(e) => setAcceptUnknown(e.target.checked)}
            />{" "}
            {t(
              "Entendo que a compatibilidade não pôde ser confirmada. A versão terá saves separados.",
            )}
          </label>
        )}
        {parent !== null && (
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={acceptStack}
              onChange={(e) => setAcceptStack(e.target.checked)}
            />{" "}
            {t('O autor indica que este patch funciona sobre "')}
            {variantLabel(variants, parent)}".
          </label>
        )}
        <label>
          {t("Nome da versão")}
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Ex.: Tradução PT-BR")}
          />
        </label>
        <button
          className="button primary full"
          disabled={!ready}
          onClick={() =>
            onInstall({
              libraryItemId: entry.item.id,
              parentVariantId: parent,
              origin: "local",
              localPath: path,
              archivePath,
              name: name.trim() || null,
              confirmUnknown: acceptUnknown,
              confirmStack: acceptStack,
            })
          }
        >
          {t("Instalar como nova versão")}
        </button>
      </div>
    </Modal>
  );
}

function SourcesDialog({
  configured,
  onClose,
  onChanged,
  notify,
}: {
  configured: boolean;
  onClose: () => void;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const sources = useQuery({
    queryKey: ["mods", "sources"],
    queryFn: () => mods.sources(),
  });
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(configured);
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      notify(message);
      await queryClient.invalidateQueries({ queryKey: ["mods"] });
      onChanged();
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("Fontes de traduções e mods")} onClose={onClose}>
      <div className="form-stack">
        <section>
          <h3>{t("Catálogos")}</h3>
          <div className="mod-sources">
            {(sources.data ?? []).map((source) => (
              <div className="variant-row" key={source.id}>
                <div>
                  <strong>{source.name}</strong>
                  <small>
                    {source.entries} {t("itens")}
                    {source.url
                      ? ` · ${source.url}`
                      : t(" · incluído no OpenRetro")}
                  </small>
                </div>
                {source.url && (
                  <div className="variant-actions">
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={source.enabled}
                        disabled={busy}
                        onChange={(e) =>
                          void act(
                            () => mods.setSource(source.id, e.target.checked),
                            e.target.checked
                              ? t("Fonte ativada.")
                              : t("Fonte desativada."),
                          )
                        }
                      />{" "}
                      {t("Ativa")}
                    </label>
                    <button
                      className="icon-button"
                      aria-label={t("Remover {name}", { name: source.name })}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => mods.removeSource(source.id),
                          t("Fonte removida."),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <label>
            {t("Adicionar catálogo (URL HTTPS de um JSON openretro-mods/1)")}
            <div className="input-action">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("https://exemplo.org/mods.json")}
              />
              <button
                className="button secondary"
                disabled={busy || !url.trim().startsWith("https://")}
                onClick={() =>
                  void act(async () => {
                    await mods.addSource(url.trim());
                    setUrl("");
                  }, t("Catálogo adicionado."))
                }
              >
                {t("Adicionar")}
              </button>
            </div>
          </label>
        </section>
        <section>
          <h3>{t("Romhack Plaza")}</h3>
          <p className="muted">
            {t(
              "A API do Romhack Plaza exige a chave da sua própria conta (crie em Settings → API Keys no site, com os escopos entries:read e entries:download). O OpenRetro respeita os limites de consultas e downloads por minuto e não copia o acervo do site. A chave fica só neste computador.",
            )}
          </p>
          {hasKey ? (
            <div className="variant-row">
              <div>
                <strong>{t("Chave configurada")}</strong>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await mods.setPlazaKey(null);
                    setHasKey(false);
                  }, t("Chave removida."))
                }
              >
                {t("Remover chave")}
              </button>
            </div>
          ) : (
            <div className="input-action">
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t("Chave de API")}
                aria-label={t("Chave de API do Romhack Plaza")}
              />
              <button
                className="button secondary"
                disabled={busy || !key.trim()}
                onClick={() =>
                  void act(async () => {
                    await mods.setPlazaKey(key.trim());
                    setKey("");
                    setHasKey(true);
                  }, t("Chave salva."))
                }
              >
                {t("Salvar")}
              </button>
            </div>
          )}
          <a
            className="metadata-source"
            href="https://community.romhackplaza.org/threads/api-usage.4782/"
            target="_blank"
            rel="noreferrer"
          >
            {t("Regras de uso da API")} <ExternalLink size={12} />
          </a>
        </section>
      </div>
    </Modal>
  );
}
