import { useRef, type RefObject } from "react";
import { Globe } from "lucide-react";
import { languages, t } from "../i18n";
import { ControllerSelect } from "../features/big-picture/ControllerSelect";
import type { AppSettings } from "../types";
import "./LanguageSelect.css";

export function LanguageSelect({
  value,
  disabled,
  onChange,
  input,
}: {
  value: NonNullable<AppSettings["interfaceLanguage"]>;
  disabled: boolean;
  onChange: (value: NonNullable<AppSettings["interfaceLanguage"]>) => void;
  input?: RefObject<((key: string) => boolean) | null>;
}) {
  const keyboard = useRef<((key: string) => boolean) | null>(null);
  return (
    <ControllerSelect
      input={input ?? keyboard}
      className="language-select"
      optionHeight={52}
      label={t("Idioma da interface")}
      value={value}
      disabled={disabled}
      onChange={(next) => onChange(next as typeof value)}
      options={[
        {
          value: "system",
          label: t("Automático (idioma do sistema)"),
          icon: <Globe size={22} aria-hidden="true" />,
        },
        ...languages.map((option) => ({
          value: option.id,
          label: option.name,
          icon: <img src={option.flag} alt="" width="27" height="18" />,
        })),
      ]}
    />
  );
}
