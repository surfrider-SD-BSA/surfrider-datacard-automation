/**
 * What can be tested here is the part that does not need Google: turning what
 * a person pasted into a folder ID.
 *
 * The picker, the consent popup and the download are three network round trips
 * through a library that only exists inside a real browser tab, and a test that
 * mocked all three would be asserting that the mock matches the code rather
 * than that the code matches Google. That part is verified by using it -- the
 * procedure is at the end of docs/google-drive.md.
 *
 * The parsing is worth a test on its own account, because getting it wrong is
 * silent: a folder ID that comes out mangled produces a picker that opens
 * somewhere unexpected with no error anywhere, which is the failure mode this
 * function exists to prevent.
 */

import { describe, expect, it } from "vitest";
import { parseFolderId } from "../src/lib/drive";

describe("parseFolderId", () => {
  it("takes a bare ID unchanged", () => {
    expect(parseFolderId("1a2B3c_D-4eF5g")).toBe("1a2B3c_D-4eF5g");
  });

  it("pulls the ID out of a folder URL", () => {
    expect(parseFolderId("https://drive.google.com/drive/folders/1a2B3c_D-4eF5g")).toBe(
      "1a2B3c_D-4eF5g",
    );
  });

  it("ignores the sharing query string Drive appends", () => {
    expect(
      parseFolderId("https://drive.google.com/drive/folders/1a2B3c_D-4eF5g?usp=drive_link"),
    ).toBe("1a2B3c_D-4eF5g");
  });

  it("handles a shared-drive URL, where the folder is not at the end", () => {
    expect(
      parseFolderId("https://drive.google.com/drive/u/0/folders/1a2B3c_D-4eF5g"),
    ).toBe("1a2B3c_D-4eF5g");
  });

  it("handles the older ?id= form", () => {
    expect(parseFolderId("https://drive.google.com/open?id=1a2B3c_D-4eF5g")).toBe("1a2B3c_D-4eF5g");
  });

  it("trims whitespace, because this is pasted by hand", () => {
    expect(parseFolderId("  1a2B3c_D-4eF5g\n")).toBe("1a2B3c_D-4eF5g");
  });

  it("is null when unset or blank, which means open on the whole Drive", () => {
    expect(parseFolderId(undefined)).toBeNull();
    expect(parseFolderId("")).toBeNull();
    expect(parseFolderId("   ")).toBeNull();
  });

  it("refuses something that is neither an ID nor a URL we recognise", () => {
    // A file URL rather than a folder one: no /folders/ segment, and the path
    // has slashes in it, so it is not a bare ID either. Better refused than
    // turned into a parent the picker cannot open.
    expect(parseFolderId("https://drive.google.com/file/d/1a2B3c/view")).toBeNull();
    expect(parseFolderId("the shared scans folder")).toBeNull();
  });
});
