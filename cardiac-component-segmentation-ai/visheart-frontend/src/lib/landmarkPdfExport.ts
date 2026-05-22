interface LandmarkExportData {
  projectName: string;
  detectionModel: string;
  totalFrames: number;
  currentFrame?: number;
  timestamp?: string;
  strainMetrics?: {
    peakGCS: string;
    peakGRS: string;
    peakGLS: string;
    alignment: string;
  };
}

type PdfLine =
  | { type: "heading"; text: string }
  | { type: "body"; text: string }
  | { type: "metric"; label: string; value: string }
  | { type: "visuals"; data: LandmarkExportData };

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const TOP_Y = 708;
const BOTTOM_Y = 58;

export const exportLandmarkPDF = async (data: LandmarkExportData) => {
  const pdfBytes = createPdf(buildReportLines(data), data);
  const buffer = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(buffer).set(pdfBytes);
  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `landmark-report-${Date.now()}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportLandmarkAsHTML = (data: LandmarkExportData): string => {
  return buildReportLines(data)
    .filter((line) => line.type !== "visuals")
    .map((line) => {
      if (line.type === "metric") return `<p><strong>${line.label}:</strong> ${line.value}</p>`;
      return `<p>${line.type === "heading" ? `<strong>${line.text}</strong>` : line.text}</p>`;
    })
    .join("\n");
};

function buildReportLines(data: LandmarkExportData): PdfLine[] {
  const generatedAt = data.timestamp || new Date().toLocaleString();
  const reportFrame = data.currentFrame != null ? `Frame ${data.currentFrame + 1}` : "All frames";

  return [
    { type: "body", text: `Project: ${data.projectName}` },
    { type: "body", text: `Generated: ${generatedAt}` },
    { type: "heading", text: "Detection Summary" },
    { type: "metric", label: "Detection Model", value: data.detectionModel },
    { type: "metric", label: "Frames Analysed", value: String(data.totalFrames || 0) },
    { type: "metric", label: "Report Frame", value: reportFrame },
    { type: "visuals", data },
    { type: "heading", text: "Landmarks Detected" },
    { type: "body", text: "RV insertion points mark the septal side of the ventricle and help orient the review." },
    { type: "body", text: "The left ventricular apex, basal references, and mid-ventricular references support frame-by-frame motion inspection." },
    { type: "heading", text: "Strain Preview Results" },
    { type: "metric", label: "Peak GCS (SAX)", value: data.strainMetrics?.peakGCS || "-17.6%" },
    { type: "metric", label: "Peak GRS (SAX)", value: data.strainMetrics?.peakGRS || "+27.8%" },
    { type: "metric", label: "Peak GLS (LAX)", value: data.strainMetrics?.peakGLS || "-16.2%" },
    { type: "metric", label: "Frame Match", value: data.strainMetrics?.alignment || "94%" },
    { type: "body", text: "Note: strain values are dummy preview values until the strain calculation pipeline is connected." },
    { type: "heading", text: "Recommendations" },
    { type: "body", text: "Review landmark positions across early, peak contraction, and late frames before exporting final project notes." },
    { type: "body", text: "Use the strain preview for workflow demonstration only until computed strain values are available." },
  ];
}

function createPdf(lines: PdfLine[], data: LandmarkExportData): Uint8Array {
  const pages: string[] = [];
  let commands: string[] = [];
  let y = TOP_Y;
  let pageNumber = 0;

  const newPage = () => {
    if (commands.length > 0) {
      drawFooter(commands, pageNumber);
      pages.push(commands.join("\n"));
    }
    pageNumber += 1;
    commands = [];
    y = TOP_Y;
    drawHeader(commands, data);
  };

  newPage();

  for (const line of lines) {
    if (line.type === "visuals") {
      const height = 214;
      if (y - height < BOTTOM_Y) newPage();
      y = drawVisualPanels(commands, y, line.data) - 18;
      continue;
    }

    const style = getLineStyle(line.type);
    const wrapped = line.type === "metric"
      ? wrapText(`${line.label}: ${line.value}`, style.size, 72)
      : wrapText(line.text, style.size, line.type === "heading" ? 70 : 88);
    const neededHeight = wrapped.length * style.leading + style.before + style.after;

    if (y - neededHeight < BOTTOM_Y) newPage();
    y -= style.before;

    if (line.type === "heading") {
      commands.push("0.12 0.28 0.64 rg");
      commands.push(`${MARGIN_X} ${y - 5} 4 18 re f`);
    }

    commands.push(`${style.color} rg`);
    for (const text of wrapped) {
      const x = MARGIN_X + (line.type === "heading" ? 14 : 0);
      commands.push(`BT /${style.font} ${style.size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`);
      y -= style.leading;
    }
    y -= style.after;
  }

  drawFooter(commands, pageNumber);
  pages.push(commands.join("\n"));
  return assemblePdf(pages);
}

function getLineStyle(type: Exclude<PdfLine["type"], "visuals">) {
  switch (type) {
    case "heading":
      return { font: "F2", size: 15, leading: 20, before: 18, after: 8, color: "0.10 0.22 0.45" };
    case "metric":
      return { font: "F2", size: 11, leading: 16, before: 2, after: 2, color: "0.08 0.08 0.08" };
    default:
      return { font: "F1", size: 11, leading: 16, before: 2, after: 4, color: "0.25 0.25 0.25" };
  }
}

function drawHeader(commands: string[], data: LandmarkExportData) {
  commands.push("0.95 0.98 1 rg");
  commands.push(`0 ${PAGE_HEIGHT - 104} ${PAGE_WIDTH} 104 re f`);
  commands.push("0.17 0.39 0.78 rg");
  commands.push(`0 ${PAGE_HEIGHT - 108} ${PAGE_WIDTH} 4 re f`);
  drawVisHeartLogo(commands, MARGIN_X, 770, 34);
  commands.push("0.10 0.22 0.45 rg");
  commands.push(`BT /F2 22 Tf ${MARGIN_X + 46} 790 Td (Cardiac Landmark Detection Report) Tj ET`);
  commands.push("0.35 0.42 0.52 rg");
  commands.push(`BT /F2 10 Tf ${MARGIN_X + 46} 774 Td (VisHeart) Tj ET`);
  commands.push(`BT /F1 9 Tf ${MARGIN_X + 96} 774 Td (- ${escapePdfText(data.projectName || "Unnamed Project")}) Tj ET`);
}

function drawVisHeartLogo(commands: string[], x: number, y: number, size: number) {
  const cx = x + size / 2;
  const cy = y + size / 2;

  commands.push("1 0.40 0.40 rg");
  commands.push(`${cx} ${cy - 10} m`);
  commands.push(`${cx - 25} ${cy + 8} ${cx - 16} ${cy + 28} ${cx} ${cy + 15} c`);
  commands.push(`${cx + 16} ${cy + 28} ${cx + 25} ${cy + 8} ${cx} ${cy - 10} c`);
  commands.push("f");

  commands.push("1 1 1 RG");
  commands.push("1.8 w");
  commands.push(`${x + 7} ${cy + 2} m`);
  commands.push(`${x + 13} ${cy + 2} l`);
  commands.push(`${x + 17} ${cy + 10} l`);
  commands.push(`${x + 22} ${cy - 5} l`);
  commands.push(`${x + 27} ${cy + 4} l`);
  commands.push(`${x + 34} ${cy + 4} l`);
  commands.push("S");
}

function drawFooter(commands: string[], pageNumber: number) {
  commands.push("0.83 0.86 0.90 RG");
  commands.push("0.8 w");
  commands.push(`${MARGIN_X} 42 m ${PAGE_WIDTH - MARGIN_X} 42 l S`);
  commands.push("0.50 0.55 0.62 rg");
  commands.push(`BT /F1 9 Tf ${MARGIN_X} 28 Td (Generated by VisHeart Landmark Detection) Tj ET`);
  commands.push(`BT /F1 9 Tf ${PAGE_WIDTH - 100} 28 Td (Page ${pageNumber}) Tj ET`);
}

function drawVisualPanels(commands: string[], y: number, data: LandmarkExportData): number {
  const panelGap = 12;
  const panelWidth = (CONTENT_WIDTH - panelGap * 2) / 3;
  const panelHeight = 188;
  const top = y - 10;
  const bottom = top - panelHeight;

  drawPanel(commands, MARGIN_X, bottom, panelWidth, panelHeight, "Landmark Overlay");
  drawLandmarkOverlay(commands, MARGIN_X + 12, bottom + 36, panelWidth - 24, 112);

  const secondX = MARGIN_X + panelWidth + panelGap;
  drawPanel(commands, secondX, bottom, panelWidth, panelHeight, "Bullseye / Strain");
  drawBullseyePreview(commands, secondX + panelWidth / 2, bottom + 94, 48);

  const thirdX = secondX + panelWidth + panelGap;
  drawPanel(commands, thirdX, bottom, panelWidth, panelHeight, "Global Curve");
  drawCurvePreview(commands, thirdX + 12, bottom + 44, panelWidth - 24, 100);

  commands.push("0.35 0.42 0.52 rg");
  commands.push(`BT /F1 8 Tf ${MARGIN_X + 8} ${bottom + 16} Td (MRI slice with detected landmark points) Tj ET`);
  commands.push(`BT /F1 8 Tf ${secondX + 8} ${bottom + 16} Td (AHA-style strain preview) Tj ET`);
  commands.push(`BT /F1 8 Tf ${thirdX + 8} ${bottom + 16} Td (Frame-based dummy strain curve) Tj ET`);

  commands.push("0.35 0.42 0.52 rg");
  commands.push(`BT /F1 8 Tf ${secondX + 8} ${bottom + 4} Td (${escapePdfText(data.strainMetrics?.peakGCS || "Peak GCS -17.6%")}) Tj ET`);

  return bottom;
}

function drawPanel(commands: string[], x: number, y: number, width: number, height: number, title: string) {
  commands.push("0.98 0.99 1 rg");
  commands.push(`${x} ${y} ${width} ${height} re f`);
  commands.push("0.82 0.86 0.92 RG");
  commands.push("0.8 w");
  commands.push(`${x} ${y} ${width} ${height} re S`);
  commands.push("0.10 0.22 0.45 rg");
  commands.push(`BT /F2 10 Tf ${x + 8} ${y + height - 18} Td (${escapePdfText(title)}) Tj ET`);
}

function drawLandmarkOverlay(commands: string[], x: number, y: number, width: number, height: number) {
  commands.push("0.10 0.11 0.13 rg");
  commands.push(`${x} ${y} ${width} ${height} re f`);
  for (let index = 0; index < 9; index += 1) {
    const shade = 0.18 + index * 0.035;
    commands.push(`${shade} ${shade} ${shade + 0.02} RG`);
    commands.push("0.8 w");
    commands.push(`${x + 10 + index * 10} ${y + 8} m ${x + width - 8} ${y + 18 + index * 8} l S`);
  }

  drawCircle(commands, x + width * 0.56, y + height * 0.52, 34, "0.18 0.18 0.18", "0.75 0.75 0.25");
  drawCircle(commands, x + width * 0.56, y + height * 0.52, 20, "0.10 0.10 0.10", "0.68 0.68 0.25");

  const points = [
    [x + width * 0.36, y + height * 0.56, "0.94 0.26 0.26"],
    [x + width * 0.69, y + height * 0.55, "0.23 0.51 0.96"],
    [x + width * 0.55, y + height * 0.79, "0.13 0.77 0.37"],
    [x + width * 0.45, y + height * 0.33, "0.98 0.58 0.24"],
    [x + width * 0.75, y + height * 0.32, "0.76 0.33 0.95"],
  ] as const;
  for (const [px, py, color] of points) {
    drawCircle(commands, px, py, 3.2, color, "1 1 1");
  }
}

function drawBullseyePreview(commands: string[], cx: number, cy: number, radius: number) {
  drawCircle(commands, cx, cy, radius, "0.93 0.12 0.14", "1 1 1");
  drawCircle(commands, cx, cy, radius * 0.68, "0.95 0.32 0.10", "1 1 1");
  drawCircle(commands, cx, cy, radius * 0.42, "0.96 0.70 0.10", "1 1 1");
  drawCircle(commands, cx, cy, radius * 0.18, "0.12 0.66 0.34", "1 1 1");
  commands.push("1 1 1 RG");
  commands.push("0.7 w");
  for (let index = 0; index < 6; index += 1) {
    const angle = (index * Math.PI) / 3;
    commands.push(`${cx} ${cy} m ${cx + Math.cos(angle) * radius} ${cy + Math.sin(angle) * radius} l S`);
  }
  commands.push("1 1 1 rg");
  commands.push(`BT /F2 8 Tf ${cx - 10} ${cy - 3} Td (AHA) Tj ET`);
}

function drawCurvePreview(commands: string[], x: number, y: number, width: number, height: number) {
  commands.push("0.08 0.09 0.10 rg");
  commands.push(`${x} ${y} ${width} ${height} re f`);
  commands.push("0.20 0.23 0.26 RG");
  commands.push("0.5 w");
  for (let index = 1; index < 5; index += 1) {
    const gy = y + (height / 5) * index;
    commands.push(`${x} ${gy} m ${x + width} ${gy} l S`);
  }
  commands.push("0.86 0.86 0.20 RG");
  commands.push("1.5 w");
  const points = [
    [0, 0.72], [0.12, 0.68], [0.25, 0.38], [0.38, 0.20], [0.52, 0.28],
    [0.66, 0.58], [0.80, 0.64], [1, 0.70],
  ];
  points.forEach(([px, py], index) => {
    const cx = x + px * width;
    const cy = y + py * height;
    commands.push(`${index === 0 ? "m" : "l"}`.replace(/^/, `${cx} ${cy} `));
  });
  commands.push("S");
  commands.push("0.18 0.43 0.86 RG");
  commands.push("0.8 w");
  commands.push(`${x + width * 0.72} ${y} m ${x + width * 0.72} ${y + height} l S`);
}

function drawCircle(commands: string[], cx: number, cy: number, radius: number, fillColor: string, strokeColor?: string) {
  const k = 0.5522847498;
  const c = radius * k;
  commands.push(`${fillColor} rg`);
  if (strokeColor) commands.push(`${strokeColor} RG`);
  commands.push(`${cx + radius} ${cy} m`);
  commands.push(`${cx + radius} ${cy + c} ${cx + c} ${cy + radius} ${cx} ${cy + radius} c`);
  commands.push(`${cx - c} ${cy + radius} ${cx - radius} ${cy + c} ${cx - radius} ${cy} c`);
  commands.push(`${cx - radius} ${cy - c} ${cx - c} ${cy - radius} ${cx} ${cy - radius} c`);
  commands.push(`${cx + c} ${cy - radius} ${cx + radius} ${cy - c} ${cx + radius} ${cy} c`);
  commands.push(strokeColor ? "B" : "f");
}

function wrapText(text: string, fontSize: number, maxChars = 82): string[] {
  const adjustedMax = Math.max(32, Math.floor(maxChars * (11 / fontSize)));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > adjustedMax && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function assemblePdf(pageStreams: string[]): Uint8Array {
  const objects: string[] = [];
  const pageObjectIds: number[] = [];

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  for (const stream of pageStreams) {
    const contentId = objects.length + 2;
    const pageId = objects.length + 1;
    pageObjectIds.push(pageId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  const parts = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  let offset = byteLength(parts[0]);

  objects.forEach((object, index) => {
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`;
    offsets.push(offset);
    parts.push(chunk);
    offset += byteLength(chunk);
  });

  const xrefOffset = offset;
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let index = 1; index <= objects.length; index += 1) {
    parts.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new TextEncoder().encode(parts.join(""));
}

function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
