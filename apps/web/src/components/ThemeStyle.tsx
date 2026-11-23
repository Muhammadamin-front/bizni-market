import { themeCss, type ContentMap } from "@shop/shared";

/** The owner's colours (admin → Sayt dizayni) as CSS variables. Renders nothing when none were chosen. Only validated hex values reach the CSS. */
export function ThemeStyle({ content }: { content: ContentMap | null | undefined }) {
  const css = themeCss(content);
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null;
}
