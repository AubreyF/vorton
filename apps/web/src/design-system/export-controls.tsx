import { useCallback, useId, useRef, useState } from "react";

type ExportFormat = "png" | "pdf";

const EXPORT_WIDTH = 1400;
const PDF_MARGIN = 24;

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function waitForPageStability(shell: HTMLElement) {
  let previousSignature = "";
  let stableSamples = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await nextPaint();
    const signature = [
      shell.scrollWidth,
      shell.scrollHeight,
      shell.textContent?.length ?? 0,
      shell.querySelectorAll("tr").length,
    ].join(":");
    const busy = shell.querySelector('[aria-busy="true"]');
    stableSamples =
      !busy && signature === previousSignature ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return;
    previousSignature = signature;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
}

function exportFileStem(installationName: string) {
  const installation =
    installationName
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "installation";
  const route =
    window.location.hash
      .replace(/^#/, "")
      .replace(/[^a-z0-9-]+/gi, "-")
      .toLowerCase() || "command-bridge";
  return `${installation}-${route}-${new Date().toISOString().slice(0, 10)}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = objectUrl;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode the page image."));
    }, type);
  });
}

async function capturePage() {
  const shell = document.querySelector<HTMLElement>(".dashboard-shell");
  if (!shell) throw new Error("The installation page shell is unavailable.");

  const root = document.documentElement;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const previousScrollBehavior = root.style.scrollBehavior;
  root.style.setProperty("scroll-behavior", "auto", "important");

  try {
    window.scrollTo(0, 0);
    await document.fonts?.ready;
    await waitForPageStability(shell);
    const { domToCanvas } = await import("modern-screenshot");
    const bounds = shell.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.ceil(Math.max(bounds.width, shell.scrollWidth)),
    );
    const height = Math.max(
      1,
      Math.ceil(Math.max(bounds.height, shell.scrollHeight)),
    );
    const backgroundColor = getComputedStyle(document.body).backgroundColor;
    const canvas = await domToCanvas(shell, {
      backgroundColor:
        backgroundColor === "rgba(0, 0, 0, 0)" ? "#ffffff" : backgroundColor,
      width,
      height,
      scale: EXPORT_WIDTH / width,
      style: { overflow: "visible" },
      filter: (node) =>
        !(node instanceof Element) ||
        !node.matches(".skip-link, .privacy-state"),
      features: { restoreScrollPosition: true },
      onCloneEachNode: (node) => {
        if (!(node instanceof HTMLElement)) return;
        node.style.setProperty("backdrop-filter", "none", "important");
        node.style.setProperty("box-shadow", "none", "important");
      },
    });
    return { canvas, backgroundColor };
  } finally {
    window.scrollTo(scrollX, scrollY);
    root.style.scrollBehavior = previousScrollBehavior;
  }
}

async function savePdf(canvas: HTMLCanvasElement, filename: string) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ compress: true, format: "a4", unit: "pt" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const printableWidth = pageWidth - PDF_MARGIN * 2;
  const printableHeight = pageHeight - PDF_MARGIN * 2;
  const sourcePageHeight = Math.max(
    1,
    Math.floor(canvas.width * (printableHeight / printableWidth)),
  );
  let sourceY = 0;
  let pageIndex = 0;

  while (sourceY < canvas.height) {
    const sliceHeight = Math.min(sourcePageHeight, canvas.height - sourceY);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceHeight;
    const context = slice.getContext("2d");
    if (!context) throw new Error("The browser could not prepare a PDF page.");
    context.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    );
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(
      slice.toDataURL("image/jpeg", 0.94),
      "JPEG",
      PDF_MARGIN,
      PDF_MARGIN,
      printableWidth,
      sliceHeight * (printableWidth / canvas.width),
    );
    sourceY += sliceHeight;
    pageIndex += 1;
  }
  pdf.save(`${filename}.pdf`);
}

export function ExportMenuSection({
  installationName,
  onRequestClose,
  onRequestOpen,
}: {
  installationName: string;
  onRequestClose: () => void;
  onRequestOpen: (focusTarget?: HTMLElement) => void;
}) {
  const statusId = useId();
  const pngButtonRef = useRef<HTMLButtonElement>(null);
  const pdfButtonRef = useRef<HTMLButtonElement>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [error, setError] = useState("");

  const exportPage = useCallback(
    async (format: ExportFormat) => {
      if (exporting) return;
      setError("");
      setExporting(format);
      onRequestClose();
      try {
        const { canvas } = await capturePage();
        const filename = exportFileStem(installationName);
        if (format === "png") {
          triggerDownload(
            await canvasToBlob(canvas, "image/png"),
            `${filename}.png`,
          );
        } else {
          await savePdf(canvas, filename);
        }
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "The page export failed.",
        );
        onRequestOpen(
          format === "png"
            ? (pngButtonRef.current ?? undefined)
            : (pdfButtonRef.current ?? undefined),
        );
      } finally {
        setExporting(null);
      }
    },
    [exporting, installationName, onRequestClose, onRequestOpen],
  );

  const status = exporting
    ? `Preparing ${exporting.toUpperCase()} export`
    : error || "Export page";

  return (
    <section
      className="account-menu-section export-menu-section"
      aria-labelledby="account-tools-heading"
    >
      <p id="account-tools-heading">Tools</p>
      <div className="export-tool-heading">
        <span>Export page</span>
        <span aria-hidden="true">Current view</span>
      </div>
      <div className="export-options">
        <button
          className="export-option"
          type="button"
          ref={pngButtonRef}
          disabled={Boolean(exporting)}
          aria-describedby={statusId}
          onClick={() => void exportPage("png")}
        >
          <span className="export-option-name">PNG</span>
          <span className="export-option-detail">Full page, 1400 px wide</span>
        </button>
        <button
          className="export-option"
          type="button"
          ref={pdfButtonRef}
          disabled={Boolean(exporting)}
          aria-describedby={statusId}
          onClick={() => void exportPage("pdf")}
        >
          <span className="export-option-name">PDF</span>
          <span className="export-option-detail">Full page, A4 pagination</span>
        </button>
      </div>
      {error && (
        <p className="export-menu-error" role="alert">
          {error}
        </p>
      )}
      <span
        className="export-live-region"
        id={statusId}
        role="status"
        aria-live="polite"
      >
        {status}
      </span>
    </section>
  );
}
