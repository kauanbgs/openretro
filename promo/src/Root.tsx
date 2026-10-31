import { Composition } from "remotion";
import { Promo, type PromoProps } from "./Promo";

const shared = {
  component: Promo,
  durationInFrames: 450,
  fps: 30,
  defaultProps: { lang: "pt" } satisfies PromoProps,
};

export const Root = () => (
  <>
    <Composition id="Promo" width={1920} height={1080} {...shared} />
    <Composition id="PromoVertical" width={1080} height={1920} {...shared} />
  </>
);
