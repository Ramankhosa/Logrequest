import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { EvidenceExtractionQualityFlag, EvidenceExtractionStatus } from "@prisma/client";

export const EVIDENCE_EXTRACTION_ENGINE_VERSION = "r3.4d-v1";
const DEFAULT_CHUNK_TARGET_TOKENS = 800;
const DEFAULT_CHUNK_OVERLAP_TOKENS = 100;
const MAX_CHUNK_TOKENS = 2500;
const MIN_CHUNK_TOKENS = 50;

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
      const parser = new PDFParse({ data: new Uint8Array(readable.buffer) });
      const parsed = await parser.getText();
      await parser.destroy();
      const text = normalizeText(parsed.text ?? "");
      return {
        status: text ? EvidenceExtractionStatus.SUCCESS : EvidenceExtractionStatus.PARTIAL,
        text: text || null,
        pageCount: Array.isArray(parsed.pages) ? parsed.pages.length : null,
        qualityFlags: [EvidenceExtractionQualityFlag.TEXT_NATIVE],
        reason: text ? null : "PDF parsed but yielded little or no text. OCR may still be required.",
        languageHints: [],
        confidence: text ? 0.88 : 0.4,
      } satisfies ExtractedEvidencePayload;
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
      return {
        status: EvidenceExtractionStatus.UNSUPPORTED,
        text: null,
        pageCount: null,
        qualityFlags: [EvidenceExtractionQualityFlag.UNSUPPORTED_FORMAT],
        reason: "Image OCR is not configured yet for this environment.",
        languageHints: [],
        confidence: null,
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
