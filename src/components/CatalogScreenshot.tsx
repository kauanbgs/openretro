import { useQuery } from "@tanstack/react-query";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../services/bridge";

export function screenshotThumbnail(url: string) {
  return url.replace(
    /^(https:\/\/images\.igdb\.com\/igdb\/image\/upload\/)t_[^/]+\//,
    "$1t_screenshot_med/",
  );
}
export function CatalogScreenshot({
  src,
  alt,
  referrerPolicy,
}: {
  src: string;
  alt: string;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
}) {
  const localThumbnail =
    isDesktop && src.startsWith("https://images.launchbox-app.com/");
  const thumbnail = useQuery({
    queryKey: ["catalog-thumbnail", src],
    queryFn: async () =>
      convertFileSrc(await invoke<string>("catalog_thumbnail", { url: src })),
    enabled: localThumbnail,
    staleTime: Infinity,
    retry: false,
  });
  const url = localThumbnail
    ? (thumbnail.data ?? (thumbnail.isError ? src : undefined))
    : screenshotThumbnail(src);
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy={referrerPolicy}
    />
  );
}
