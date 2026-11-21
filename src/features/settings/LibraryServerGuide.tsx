import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { bridge } from "../../services/bridge";
import { t } from "../../i18n";

/**
 * Step by step for sharing a library between two PCs. Open while the server
 * is off, which is when someone new to this needs it; closed once it runs.
 */
export function LibraryServerGuide() {
  const { data: status } = useQuery({
    queryKey: ["library-server"],
    queryFn: bridge.libraryServerStatus,
    refetchInterval: 3000,
  });
  const running = status?.running ?? false;
  return (
    <details
      key={running ? "on" : "off"}
      className="library-guide"
      open={!running}
    >
      <summary>
        <BookOpen size={16} /> {t("Como usar, passo a passo")}
      </summary>
      <p>
        {t(
          "Um PC guarda os jogos e o outro baixa e joga. O jogo não é transmitido: ele é baixado e roda no PC de quem joga.",
        )}
      </p>
      <h4>{t("No PC que tem os jogos")}</h4>
      <ol>
        <li>
          {t(
            "Ligue Compartilhar minha biblioteca. Na primeira vez, o OpenRetro prepara o acesso de fora de casa sozinho: aceite a janela do Windows e entre, ou crie uma conta grátis, na página que abrir no navegador.",
          )}
        </li>
        <li>
          {t(
            "Copie o link de pareamento. Ele funciona como uma senha: não o poste em lugares públicos.",
          )}
        </li>
        <li>
          {t("Deixe o OpenRetro aberto neste PC enquanto o outro baixa.")}
        </li>
      </ol>
      <h4>{t("No PC onde você quer jogar")}</h4>
      <ol>
        <li>
          {t(
            "Instale o OpenRetro, abra Configurações, Servidor, e cole o link em Conectar a outro PC.",
          )}
        </li>
        <li>
          {t(
            "Na primeira vez, entre com a mesma conta do outro PC e toque em Conectar de novo.",
          )}
        </li>
        <li>
          {t(
            "Abra o jogo no Catálogo, clique em baixar e escolha a fonte OpenRetro com o nome do PC. O progresso aparece em Downloads e o jogo entra na sua biblioteca.",
          )}
        </li>
      </ol>
      <h4>{t("Só em casa, sem instalar nada")}</h4>
      <p>
        {t(
          "Ligue Também pela rede local no PC dos jogos e use o link da rede local. Jogos novos aparecem em Fontes, no botão Sincronizar.",
        )}
      </p>
      <p className="library-guide-note">
        {t(
          "Jogos que são pastas, como os de PS3, não são compartilhados por enquanto.",
        )}
      </p>
    </details>
  );
}
