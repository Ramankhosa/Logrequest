import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  detectJournalImportFormat,
  parseJournalImportBuffer,
} from "@/lib/journals/parser";

const SAMPLE_FILE =
  "C:/Users/raman/Downloads/scimagojr 2024 (1).csv";

const INLINE_SAMPLE = [
  "Rank;Sourceid;Title;Type;Issn;Publisher;Open Access;Open Access Diamond;SJR;SJR Best Quartile;H index;Total Docs. (2024);Total Docs. (3years);Total Refs.;Total Citations (3years);Citable Docs. (3years);Citations / Doc. (2years);Ref. / Doc.;%Female;Overton;SDG;Country;Region;Publisher;Coverage;Categories;Areas,,,,,,,",
  "\"1;28773;\"\"Ca-A Cancer Journal for Clinicians\"\";journal;\"\"15424863\",\" 00079235\"\";\"\"John Wiley and Sons Inc\"\";No;No;145\",004;Q1;223;43;122;2704;40834;81;168,71;62,88;48,\"21;4;37;United States;Northern America;\"\"John Wiley and Sons Inc\"\";\"\"1950-2025\"\";\"\"Hematology (Q1); Oncology (Q1)\"\";\"\"Medicine\"\"\",,",
  "\"2;19434;\"\"MMWR Recommendations and Reports\"\";journal;\"\"10575987\",\" 15458601\"\";\"\"Centers for Disease Control and Prevention (CDC)\"\";Yes;No;41\",754;Q1;155;6;15;1652;1308;15;75,11;275,33;75,\"93;1;5;United States;Northern America;\"\"Centers for Disease Control and Prevention (CDC)\"\";\"\"1990-2024\"\";\"\"Epidemiology (Q1); Health Information Management (Q1)\"\";\"\"Health Professions; Medicine\"\"\",",
].join("\n");

function loadSampleBuffer() {
  if (existsSync(SAMPLE_FILE)) {
    return readFileSync(SAMPLE_FILE);
  }

  return Buffer.from(INLINE_SAMPLE, "utf8");
}

describe("journal SCImago parser", () => {
  test("detects and parses the raw SCImago export format", () => {
    const buffer = loadSampleBuffer();

    expect(detectJournalImportFormat(buffer, "scimagojr-2024.csv")).toBe(
      "SCIMAGO_RAW",
    );

    const result = parseJournalImportBuffer({
      buffer,
      fileName: "scimagojr 2024 (1).csv",
      sourceYear: 2024,
    });

    expect(result.detectedFormat).toBe("SCIMAGO_RAW");
    expect(result.sourceYear).toBe(2024);
    expect(result.rows.length).toBeGreaterThan(0);

    const firstRow = result.rows[0];
    expect(firstRow?.errors).toEqual([]);
    expect(firstRow?.normalizedData?.title).toBe("Ca-A Cancer Journal for Clinicians");
    expect(firstRow?.normalizedData?.issnPrimary).toBe("1542-4863");
    expect(firstRow?.normalizedData?.issnList).toContain("0007-9235");
    expect(firstRow?.normalizedData?.sjrBestQuartile).toBe("Q1");
    expect(firstRow?.normalizedData?.isJournalEligible).toBe(true);
  });

  test("keeps malformed whole-row quoting recoverable instead of rejecting the row", () => {
    const buffer = Buffer.from(INLINE_SAMPLE, "utf8");

    const result = parseJournalImportBuffer({
      buffer,
      fileName: "official-scimagojr-2024.csv",
      sourceYear: 2024,
    });

    expect(result.rows[0]?.errors).toEqual([]);
    expect(result.rows[1]?.errors).toEqual([]);
    expect(result.rows[1]?.normalizedData?.title).toBe(
      "MMWR Recommendations and Reports",
    );
  });
});
