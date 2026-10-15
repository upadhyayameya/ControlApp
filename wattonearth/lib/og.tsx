import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LOGO_PATH } from "@/components/Logo";

export const ogSize = { width: 1200, height: 630 };

const fontsDir = join(process.cwd(), "public", "fonts");

/** Branded Open Graph card used by the site default and every news post. */
export async function renderOgImage({
  eyebrow,
  title,
  footer,
}: {
  eyebrow: string;
  title: string;
  footer?: string;
}) {
  const [regular, semibold] = await Promise.all([
    readFile(join(fontsDir, "Geist-Regular.ttf")),
    readFile(join(fontsDir, "Geist-SemiBold.ttf")),
  ]);
  const size = title.length > 90 ? 52 : title.length > 60 ? 60 : 72;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0c0c0b",
          color: "#f3efe6",
          padding: "64px 72px",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 64 64" fill="none">
            <path d={LOGO_PATH} stroke="#e9dcc2" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 24, letterSpacing: 6, fontWeight: 600 }}>WATT ON EARTH</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 24, color: "#dcc6a0", letterSpacing: 4, textTransform: "uppercase" }}>{eyebrow}</div>
          <div style={{ fontSize: size, fontWeight: 600, lineHeight: 1.1, marginTop: 20, letterSpacing: -1 }}>{title}</div>
        </div>
        <div style={{ fontSize: 24, color: "#aaa396" }}>{footer ?? "wattonearth.in"}</div>
      </div>
    ),
    {
      ...ogSize,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}
