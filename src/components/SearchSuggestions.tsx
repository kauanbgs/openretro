import { useEffect, useState, type RefObject } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  catalogSuggest,
  type CatalogSuggestion,
} from "../providers/metadata/LaunchboxMetadataProvider";
import { platformById } from "../db/platforms";
import { t } from "../i18n";

interface Props {
  input: RefObject<HTMLInputElement | null>;
  query: string;
  enabled: boolean;
  onPick: (suggestion: CatalogSuggestion) => void;
  onSeeAll: () => void;
}

/** Marks the part of the title that matches, preferring a word start. */
function Highlight({ title, query }: { title: string; query: string }) {
  const fold = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const plain = fold(title),
    needle = fold(query.trim());
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^a-z0-9])${escaped}`).exec(plain);
  const at = word ? word.index + word[1].length : plain.indexOf(needle);
  // Folding can change the length (ligatures); then skip the mark.
  if (!needle || at < 0 || plain.length !== title.length) return <>{title}</>;
  return (
    <>
      {title.slice(0, at)}
      <mark>{title.slice(at, at + needle.length)}</mark>
      {title.slice(at + needle.length)}
    </>
  );
}

/** The dropdown under the header search: catalog titles while typing. */
export function SearchSuggestions({
  input,
  query,
  enabled,
  onPick,
  onSeeAll,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [term, setTerm] = useState(query.trim());
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 120);
    return () => clearTimeout(timer);
  }, [query]);
  const suggestions = useQuery({
    queryKey: ["catalog-suggest", term],
    queryFn: () => catalogSuggest(term),
    enabled: enabled && term.length >= 2,
    staleTime: 300000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const items = enabled && term.length >= 2 ? (suggestions.data ?? []) : [];
  const visible = open && items.length > 0 && query.trim().length >= 2;
  useEffect(() => setActive(-1), [term]);
  useEffect(() => {
    if (document.activeElement === input.current) setOpen(true);
  }, [query, input]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const show = () => setOpen(true),
      hide = () => setOpen(false);
    el.addEventListener("focus", show);
    el.addEventListener("blur", hide);
    return () => {
      el.removeEventListener("focus", show);
      el.removeEventListener("blur", hide);
    };
  }, [input]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    // The last row is "see all results".
    const rows = items.length + 1;
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") return setOpen(false);
      if (!items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        if (!visible) return;
        setActive((a) =>
          e.key === "ArrowDown" ? (a + 1) % rows : a <= 0 ? rows - 1 : a - 1,
        );
      } else if (e.key === "Enter" && visible) {
        setOpen(false);
        if (active >= 0 && active < items.length) onPick(items[active]);
        else onSeeAll();
      }
    }
    el.addEventListener("keydown", key);
    return () => el.removeEventListener("keydown", key);
  }, [input, items, active, visible, onPick, onSeeAll]);
  if (!visible) return null;
  return (
    <div
      className="search-suggestions"
      role="listbox"
      aria-label={t("Sugestões")}
      // Keep focus in the input so the list does not close before the click.
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((s, i) => {
        const platform = platformById(s.platformId);
        return (
          <button
            key={s.id}
            type="button"
            role="option"
            aria-selected={i === active}
            className={i === active ? "active" : ""}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              setOpen(false);
              onPick(s);
            }}
          >
            {s.coverUrl ? (
              <img src={s.coverUrl} alt="" loading="lazy" />
            ) : (
              <i>{platform?.shortName}</i>
            )}
            <span>
              <strong>
                <Highlight title={s.title} query={query} />
              </strong>
              <small>
                {platform?.shortName ?? s.platformId}
                {s.year ? ` · ${s.year}` : ""}
              </small>
            </span>
          </button>
        );
      })}
      <button
        type="button"
        role="option"
        aria-selected={active === items.length}
        className={`search-suggestions-all ${active === items.length ? "active" : ""}`}
        onMouseEnter={() => setActive(items.length)}
        onClick={() => {
          setOpen(false);
          onSeeAll();
        }}
      >
        <Search size={14} />
        {t("Ver todos os resultados para “{query}”", { query: query.trim() })}
      </button>
    </div>
  );
}
