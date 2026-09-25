import { describe, expect, it } from "vitest";
import { describeParts, partialRestoreNotes } from "./parts";

const none = { database: false, analysis: false, artwork: false, libraryFiles: false };

describe("restore parts", () => {
  it("names the chosen parts as a sentence would", () => {
    expect(describeParts({ ...none, database: true })).toBe("the library database");
    expect(describeParts({ ...none, database: true, analysis: true })).toBe("the library database and analysis files");
    expect(describeParts({ database: true, analysis: true, artwork: true, libraryFiles: true }))
      .toBe("the library database, analysis files, artwork and Sync Manager and Automix selections");
  });

  it("warns only when the database and analysis are split", () => {
    expect(partialRestoreNotes({ ...none, database: true, analysis: true })).toEqual([]);
    expect(partialRestoreNotes({ ...none, artwork: true })).toEqual([]);
    expect(partialRestoreNotes({ ...none, database: true })[0]).toMatch(/^Analysis files stay/);
    expect(partialRestoreNotes({ ...none, analysis: true })[0]).toMatch(/^The library database stays/);
  });
});
