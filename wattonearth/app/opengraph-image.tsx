import { renderOgImage, ogSize } from "@/lib/og";

export const alt = "Watt on Earth — energy & carbon advisory for India";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return renderOgImage({
    eyebrow: "Energy & carbon advisory · India",
    title: "Measure. Reduce. Verify.",
    footer: "Energy audits · M&V · CCTS · CBAM · BRSR · ECBC — wattonearth.in",
  });
}
