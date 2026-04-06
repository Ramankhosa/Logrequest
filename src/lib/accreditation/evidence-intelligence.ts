import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import engData from "@tesseract.js-data/eng";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { createWorker, PSM } from "tesseract.js";
import { EvidenceExtractionQualityFlag, EvidenceExtractionStatus } from "@prisma/client";

export const EVIDENCE_EXTRACTION_ENGINE_VERSION = "r3.4d-v2";
const DEFAULT_CHUNK_TARGET_TOKENS = 800;
const DEFAULT_CHUNK_OVERLAP_TOKENS = 100;
const MAX_CHUNK_TOKENS = 2500;
const MIN_CHUNK_TOKENS = 50;
const OCR_CONFIDENCE_THRESHOLD = 0.7;
const PDF_NATIVE_TEXT_MIN_CHARS = 120;
const MAX_PDF_OCR_PAGES = 10;
const LOCAL_TESSERACT_WORKER_PATH = resolve(
  process.cwd(),
  "node_modules",
  "tesseract.js",
  "src",
  "worker-script",
  "node",
  "index.js",
);
const LOCAL_TESSERACT_CORE_PATH = dirname(
  resolve(process.cwd(), "node_modules", "tesseract.js-core", "package.json"),
);

export type CopilotGroundingStatus =
  | "FULLY_GROUNDED"
  | "PARTIALLY_GROUNDED"
  | "METADATA_ONLY"
  | "NO_EVIDENCE"
  | "INSUFFICIENT_GROUNDING";

export type CopilotCitation = {
  type: string;
  ref: string;
  snippet: string;
  confidence: number;
  evidenceVersionId?: string | null;
  chunkId?: string | null;
  metricCode?: string | null;
  responseFieldKey?: string | null;
};

export type ExtractedEvidencePayload = {
  status: EvidenceExtractionStatus;
  text: string | null;
  pageCount: number | null;
  qualityFlags: EvidenceExtractionQualityFlag[];
  reason: string | null;
  languageHints: string[];
  confidence: number | null;
};

export type ChunkDraft = {
  chunkIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionHeading: string | null;
  contentType: string;
  plainText: string;
  charCount: number;
  tokenEstimate: number;
  confidence: number | null;
  metadata: Record<string, unknown>;
};

type ReadableFile = {
  buffer: Buffer;
  extension: string;
  fileType: string | null;
};

type OcrResult = {
  text: string | null;
  confidence: number | null;
  qualityFlags: EvidenceExtractionQualityFlag[];
  languageHints: string[];
  reason: string | null;
};

type RenderedPdfPages = {
  pageCount: number;
  renderedPageCount: number;
  images: Array<{
    pageNumber: number;
    buffer: Buffer;
  }>;
};

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

let ocrWorkerPromise: Promise<TesseractWorker> | null = null;

function tryParseDataUrl(url: string) {
  if (!url.startsWith("data:")) {
    return null;
  }
  const separatorIndex = url.indexOf(",");
  if (separatorIndex === -1) {
    return null;
  }
  const header = url.slice(5, separatorIndex);
  const body = url.slice(separatorIndex + 1);
  const isBase64 = header.endsWith(";base64");
  const mimeType = header.split(";")[0] || null;
  return {
    mimeType,
    buffer: Buffer.from(body, isBase64 ? "base64" : "utf8"),
  };
}

async function readEvidenceFile(fileUrl: string, fileName: string, fileType: string | null): Promise<ReadableFile> {
  const dataUrl = tryParseDataUrl(fileUrl);
  if (dataUrl) {
    return {
      buffer: dataUrl.buffer,
      extension: extname(fileName).toLowerCase(),
      fileType: fileType ?? dataUrl.mimeType,
    };
  }

  if (/^https?:\/\//i.test(fileUrl)) {
    const response = await fetch(fileUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Unable to download evidence file (${response.status}).`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      extension: extname(fileName).toLowerCase(),
      fileType: fileType ?? response.headers.get("content-type"),
    };
  }

  const candidatePath = isAbsolute(fileUrl) ? fileUrl : resolve(process.cwd(), fileUrl);
  const buffer = await readFile(candidatePath);
  return {
    buffer,
    extension: extname(fileName).toLowerCase(),
    fileType,
  };
}

function normalizeText(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function buildReason(parts: Array<string | null | undefined>) {
  const normalized = parts
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  return normalized.length > 0 ? normalized.join(" ") : null;
}

function looksPlainText(extension: string, fileType: string | null) {
  const lowerType = (fileType ?? "").toLowerCase();
  return (
    lowerType.includes("text") ||
    lowerType.includes("json") ||
    lowerType.includes("csv") ||
    [".txt", ".md", ".json", ".csv"].includes(extension)
  );
}

function looksPdf(extension: string, fileType: string | null) {
  const lowerType = (fileType ?? "").toLowerCase();
  return extension === ".pdf" || lowerType.includes("pdf");
}

function looksDocx(extension: string, fileType: string | null) {
  const lowerType = (fileType ?? "").toLowerCase();
  return (
    extension === ".docx" ||
    lowerType.includes("wordprocessingml") ||
    lowerType.includes("msword")
  );
}

function looksImage(extension: string, fileType: string | null) {
  const lowerType = (fileType ?? "").toLowerCase();
  return lowerType.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"].includes(extension);
}

function ensurePdfGlobals() {
  const scope = globalThis as Record<string, unknown>;
  if (!scope.DOMMatrix) {
    scope.DOMMatrix = DOMMatrix as unknown;
  }
  if (!scope.ImageData) {
    scope.ImageData = ImageData as unknown;
  }
  if (!scope.Path2D) {
    scope.Path2D = Path2D as unknown;
  }
}

function isWeakPdfNativeText(text: string | null) {
  if (!text) {
    return true;
  }
  const normalized = normalizeText(text);
  if (normalized.length < PDF_NATIVE_TEXT_MIN_CHARS) {
    return true;
  }
  const alphaNumericCount = normalized.replace(/[^a-z0-9]/gi, "").length;
  return alphaNumericCount < 60;
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        workerPath: LOCAL_TESSERACT_WORKER_PATH,
        corePath: LOCAL_TESSERACT_CORE_PATH,
        langPath: engData.langPath,
        gzip: engData.gzip,
        cacheMethod: "none",
        logger: () => undefined,
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });
      return worker;
    })().catch((error) => {
      ocrWorkerPromise = null;
      throw error;
    });
  }

  return ocrWorkerPromise;
}

async function recognizeImageWithOcr(buffer: Buffer, sourceLabel: string): Promise<OcrResult> {
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(buffer, { rotateAuto: true }, { text: true });
    const rawText = normalizeText(result.data.text ?? "");
    const confidence = typeof result.data.confidence === "number" ? result.data.confidence / 100 : null;
    const qualityFlags: EvidenceExtractionQualityFlag[] = [EvidenceExtractionQualityFlag.OCR_USED];
    if (confidence !== null && confidence < OCR_CONFIDENCE_THRESHOLD) {
      qualityFlags.push(EvidenceExtractionQualityFlag.LOW_CONFIDENCE);
    }

    return {
      text: rawText || null,
      confidence,
      qualityFlags,
      languageHints: rawText ? ["eng"] : [],
      reason: rawText ? null : `OCR could not recover readable text from ${sourceLabel}.`,
    };
  } catch (error) {
    return {
      text: null,
      confidence: null,
      qualityFlags: [
        EvidenceExtractionQualityFlag.OCR_USED,
        EvidenceExtractionQualityFlag.METADATA_ONLY,
      ],
      languageHints: [],
      reason: error instanceof Error ? error.message : `OCR failed for ${sourceLabel}.`,
    };
  }
}

async function renderPdfPagesForOcr(buffer: Buffer): Promise<RenderedPdfPages> {
  ensurePdfGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;

  try {
    const pageCount = pdf.numPages;
    const renderedPageCount = Math.min(pageCount, MAX_PDF_OCR_PAGES);
    const images: RenderedPdfPages["images"] = [];

    for (let pageNumber = 1; pageNumber <= renderedPageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 2 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const canvasContext = canvas.getContext("2d");
        await page.render({
          canvas: canvas as never,
          canvasContext: canvasContext as never,
          viewport,
          intent: "print",
        }).promise;
        images.push({
          pageNumber,
          buffer: canvas.toBuffer("image/png"),
        });
      } finally {
        page.cleanup();
      }
    }

    return {
      pageCount,
      renderedPageCount,
      images,
    };
  } finally {
    await pdf.destroy();
  }
}

async function extractPdfWithFallback(buffer: Buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const parsed = await parser.getText();
  await parser.destroy();

  const nativeText = normalizeText(parsed.text ?? "");
  const pageCount = Array.isArray(parsed.pages) ? parsed.pages.length : null;
  if (!isWeakPdfNativeText(nativeText)) {
    return {
      status: EvidenceExtractionStatus.SUCCESS,
      text: nativeText,
      pageCount,
      qualityFlags: [EvidenceExtractionQualityFlag.TEXT_NATIVE],
      reason: null,
      languageHints: [],
      confidence: 0.88,
    } satisfies ExtractedEvidencePayload;
  }

  try {
    const rendered = await renderPdfPagesForOcr(buffer);
    const pageTexts: string[] = [];
    const confidences: number[] = [];
    const qualityFlags = new Set<EvidenceExtractionQualityFlag>();
    if (nativeText) {
      qualityFlags.add(EvidenceExtractionQualityFlag.TEXT_NATIVE);
    }
    for (const page of rendered.images) {
      const ocr = await recognizeImageWithOcr(page.buffer, `PDF page ${page.pageNumber}`);
      for (const flag of ocr.qualityFlags) {
        qualityFlags.add(flag);
      }
      if (ocr.confidence !== null) {
        confidences.push(ocr.confidence);
      }
      if (ocr.text) {
        pageTexts.push(`Page ${page.pageNumber}\n${ocr.text}`);
      }
    }

    if (rendered.pageCount > rendered.renderedPageCount) {
      qualityFlags.add(EvidenceExtractionQualityFlag.TOO_LARGE);
    }
    const ocrText = normalizeText(pageTexts.join("\n\n"));
    const averageConfidence =
      confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null;
    if (averageConfidence !== null && averageConfidence < OCR_CONFIDENCE_THRESHOLD) {
      qualityFlags.add(EvidenceExtractionQualityFlag.LOW_CONFIDENCE);
    }

    if (ocrText) {
      return {
        status:
          rendered.pageCount > rendered.renderedPageCount || qualityFlags.has(EvidenceExtractionQualityFlag.LOW_CONFIDENCE)
            ? EvidenceExtractionStatus.PARTIAL
            : EvidenceExtractionStatus.SUCCESS,
        text: ocrText,
        pageCount: rendered.pageCount,
        qualityFlags: Array.from(qualityFlags),
        reason: buildReason([
          nativeText ? "Native PDF text was too weak; OCR fallback used." : null,
          rendered.pageCount > rendered.renderedPageCount
            ? `Only the first ${rendered.renderedPageCount} PDF pages were OCR processed.`
            : null,
        ]),
        languageHints: ["eng"],
        confidence: averageConfidence ?? 0.6,
      } satisfies ExtractedEvidencePayload;
    }

    return {
      status: nativeText ? EvidenceExtractionStatus.PARTIAL : EvidenceExtractionStatus.FAILED,
      text: nativeText || null,
      pageCount: rendered.pageCount,
      qualityFlags: Array.from(qualityFlags.size > 0 ? qualityFlags : [EvidenceExtractionQualityFlag.METADATA_ONLY]),
      reason: buildReason([
        nativeText ? "PDF yielded only weak native text and OCR fallback did not recover enough readable content." : null,
        !nativeText ? "PDF OCR fallback did not recover readable text." : null,
      ]),
      languageHints: nativeText ? [] : ["eng"],
      confidence: nativeText ? 0.45 : averageConfidence,
    } satisfies ExtractedEvidencePayload;
  } catch (error) {
    return {
      status: nativeText ? EvidenceExtractionStatus.PARTIAL : EvidenceExtractionStatus.FAILED,
      text: nativeText || null,
      pageCount,
      qualityFlags: nativeText
        ? [EvidenceExtractionQualityFlag.TEXT_NATIVE, EvidenceExtractionQualityFlag.LOW_CONFIDENCE]
        : [EvidenceExtractionQualityFlag.METADATA_ONLY],
      reason: buildReason([
        nativeText ? "PDF yielded weak native text." : null,
        error instanceof Error ? error.message : "PDF OCR fallback failed.",
      ]),
      languageHints: [],
      confidence: nativeText ? 0.45 : null,
    } satisfies ExtractedEvidencePayload;
  }
}

export function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

export function buildCitation(input: {
  type: string;
  ref: string;
  snippet: string;
  confidence?: number;
  evidenceVersionId?: string | null;
  chunkId?: string | null;
  metricCode?: string | null;
  responseFieldKey?: string | null;
}): CopilotCitation {
  return {
    type: input.type,
    ref: input.ref,
    snippet: input.snippet,
    confidence: input.confidence ?? 0.9,
    evidenceVersionId: input.evidenceVersionId ?? null,
    chunkId: input.chunkId ?? null,
    metricCode: input.metricCode ?? null,
    responseFieldKey: input.responseFieldKey ?? null,
  };
}

function splitParagraphs(text: string) {
  return normalizeText(text)
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function takeOverlap(paragraphs: string[], targetTokens: number) {
  const overlap: string[] = [];
  let tokens = 0;
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index];
    const paragraphTokens = estimateTokenCount(paragraph);
    if (tokens >= targetTokens && overlap.length > 0) {
      break;
    }
    overlap.unshift(paragraph);
    tokens += paragraphTokens;
  }
  return overlap;
}

export function buildEvidenceChunks(text: string, sectionHeading: string | null = null): ChunkDraft[] {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: ChunkDraft[] = [];
  let bucket: string[] = [];
  let bucketTokens = 0;

  const pushChunk = () => {
    const plainText = bucket.join("\n\n").trim();
    if (!plainText) {
      bucket = [];
      bucketTokens = 0;
      return;
    }
    const tokenEstimate = estimateTokenCount(plainText);
    if (tokenEstimate < MIN_CHUNK_TOKENS && chunks.length > 0) {
      const previous = chunks[chunks.length - 1];
      previous.plainText = `${previous.plainText}\n\n${plainText}`.trim();
      previous.charCount = previous.plainText.length;
      previous.tokenEstimate = estimateTokenCount(previous.plainText);
      previous.metadata = {
        ...previous.metadata,
        mergedTrailingChunk: true,
      };
    } else {
      chunks.push({
        chunkIndex: chunks.length,
        pageStart: null,
        pageEnd: null,
        sectionHeading,
        contentType: "TEXT",
        plainText,
        charCount: plainText.length,
        tokenEstimate,
        confidence: 0.9,
        metadata: {
          paragraphCount: bucket.length,
        },
      });
    }
    bucket = [];
    bucketTokens = 0;
  };

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokenCount(paragraph);
    if (paragraphTokens > MAX_CHUNK_TOKENS) {
      pushChunk();
      const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
      let sentenceBucket = "";
      for (const sentence of sentences) {
        const candidate = sentenceBucket ? `${sentenceBucket} ${sentence}` : sentence;
        if (estimateTokenCount(candidate) > MAX_CHUNK_TOKENS && sentenceBucket) {
          chunks.push({
            chunkIndex: chunks.length,
            pageStart: null,
            pageEnd: null,
            sectionHeading,
            contentType: "TEXT",
            plainText: sentenceBucket.trim(),
            charCount: sentenceBucket.trim().length,
            tokenEstimate: estimateTokenCount(sentenceBucket),
            confidence: 0.86,
            metadata: { splitMode: "sentence" },
          });
          sentenceBucket = sentence;
        } else {
          sentenceBucket = candidate;
        }
      }
      if (sentenceBucket.trim()) {
        chunks.push({
          chunkIndex: chunks.length,
          pageStart: null,
          pageEnd: null,
          sectionHeading,
          contentType: "TEXT",
          plainText: sentenceBucket.trim(),
          charCount: sentenceBucket.trim().length,
          tokenEstimate: estimateTokenCount(sentenceBucket),
          confidence: 0.86,
          metadata: { splitMode: "sentence" },
        });
      }
      continue;
    }

    if (bucketTokens + paragraphTokens > DEFAULT_CHUNK_TARGET_TOKENS && bucket.length > 0) {
      pushChunk();
      bucket = takeOverlap(bucket, DEFAULT_CHUNK_OVERLAP_TOKENS);
      bucketTokens = bucket.reduce((sum, segment) => sum + estimateTokenCount(segment), 0);
    }

    bucket.push(paragraph);
    bucketTokens += paragraphTokens;
  }

  pushChunk();
  return chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index }));
}

export async function extractEvidenceContent(fileUrl: string, fileName: string, fileType: string | null) {
  try {
    const readable = await readEvidenceFile(fileUrl, fileName, fileType);

    if (looksPlainText(readable.extension, readable.fileType)) {
      const text = normalizeText(readable.buffer.toString("utf8"));
      return {
        status: text ? EvidenceExtractionStatus.SUCCESS : EvidenceExtractionStatus.PARTIAL,
        text: text || null,
        pageCount: null,
        qualityFlags: [EvidenceExtractionQualityFlag.TEXT_NATIVE],
        reason: text ? null : "Plain-text file contained no extractable content.",
        languageHints: [],
        confidence: text ? 0.96 : 0.4,
      } satisfies ExtractedEvidencePayload;
    }

    if (looksPdf(readable.extension, readable.fileType)) {
      return extractPdfWithFallback(readable.buffer);
    }

    if (looksDocx(readable.extension, readable.fileType)) {
      const result = await mammoth.extractRawText({ buffer: readable.buffer });
      const text = normalizeText(result.value ?? "");
      return {
        status: text ? EvidenceExtractionStatus.SUCCESS : EvidenceExtractionStatus.PARTIAL,
        text: text || null,
        pageCount: null,
        qualityFlags: [EvidenceExtractionQualityFlag.TEXT_NATIVE],
        reason: result.messages.map((message) => message.message).join("; ") || null,
        languageHints: [],
        confidence: text ? 0.9 : 0.42,
      } satisfies ExtractedEvidencePayload;
    }

    if (looksImage(readable.extension, readable.fileType)) {
      const ocr = await recognizeImageWithOcr(readable.buffer, fileName);
      return {
        status: ocr.text ? EvidenceExtractionStatus.SUCCESS : EvidenceExtractionStatus.PARTIAL,
        text: ocr.text,
        pageCount: null,
        qualityFlags: ocr.qualityFlags,
        reason: ocr.reason,
        languageHints: ocr.languageHints,
        confidence: ocr.confidence,
      } satisfies ExtractedEvidencePayload;
    }

    return {
      status: EvidenceExtractionStatus.UNSUPPORTED,
      text: null,
      pageCount: null,
      qualityFlags: [EvidenceExtractionQualityFlag.UNSUPPORTED_FORMAT],
      reason: "Unsupported file type.",
      languageHints: [],
      confidence: null,
    } satisfies ExtractedEvidencePayload;
  } catch (error) {
    return {
      status: EvidenceExtractionStatus.FAILED,
      text: null,
      pageCount: null,
      qualityFlags: [EvidenceExtractionQualityFlag.METADATA_ONLY],
      reason: error instanceof Error ? error.message : "Evidence extraction failed.",
      languageHints: [],
      confidence: null,
    } satisfies ExtractedEvidencePayload;
  }
}
