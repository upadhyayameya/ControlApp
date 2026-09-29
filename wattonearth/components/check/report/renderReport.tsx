/**
 * Client-only entry point for PDF generation. Imported dynamically from the
 * lead gate so @react-pdf/renderer is only downloaded when a report is requested.
 */
import { Font, pdf } from "@react-pdf/renderer";
import { CheckReportDocument } from "@/components/check/report/CheckReportDocument";
import type { ReportContact } from "@/components/check/LeadGate";
import type { CheckInput, CheckResult } from "@/lib/types";

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  const base = `${window.location.origin}/fonts`;
  // Geist includes the ₹ and subscript glyphs; the PDF built-in fonts do not.
  Font.register({
    family: "Geist",
    fonts: [
      { src: `${base}/Geist-Regular.ttf`, fontWeight: 400 },
      { src: `${base}/Geist-Medium.ttf`, fontWeight: 500 },
      { src: `${base}/Geist-SemiBold.ttf`, fontWeight: 600 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

export async function renderCheckReport(props: {
  input: CheckInput;
  result: CheckResult;
  contact: ReportContact;
  isSample: boolean;
  generatedAt: Date;
}): Promise<Blob> {
  registerFonts();
  return pdf(<CheckReportDocument {...props} />).toBlob();
}
