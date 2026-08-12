import { describe, expect, it } from "vitest";
import {
  countValues,
  createDraftStore,
  describeAge,
  draftMatches,
  type Draft,
} from "../src/lib/draft";

/** localStorage, minus the browser. */
function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
    ...overrides,
  } as Storage;
}

const draft = (over: Partial<Draft> = {}): Draft => ({
  fileName: "9.27.25_Pacific-Beach_CH54.pdf",
  fileSize: 12345,
  cardCount: 58,
  cellCount: 453,
  savedAt: Date.now(),
  event: { date: "2025-09-27", shoreline: "Pacific Beach" },
  values: [
    [1, [[18, 12], [33, 4]]],
    [2, [[18, 7]]],
  ],
  ...over,
});

describe("the draft store", () => {
  it("round-trips a draft", () => {
    const store = createDraftStore(fakeStorage());
    const d = draft();
    store.save(d);
    expect(store.load()).toEqual(d);
  });

  it("reports itself unavailable when the browser refuses to write", () => {
    // Safari in private mode: the API is there and setItem throws.
    const store = createDraftStore(
      fakeStorage({
        setItem: () => {
          throw new DOMException("quota", "QuotaExceededError");
        },
      }),
    );
    expect(store.available).toBe(false);
  });

  it("does not take the page down when a save fails mid-session", () => {
    const storage = fakeStorage();
    const store = createDraftStore(storage);
    storage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    expect(() => store.save(draft())).not.toThrow();
  });

  it("ignores stored junk rather than restoring nonsense", () => {
    const storage = fakeStorage();
    const store = createDraftStore(storage);
    storage.setItem("surfrider-datacard:draft:v1", "{not json");
    expect(store.load()).toBeNull();

    storage.setItem("surfrider-datacard:draft:v1", JSON.stringify({ fileName: 3 }));
    expect(store.load()).toBeNull();
  });

  it("clears", () => {
    const store = createDraftStore(fakeStorage());
    store.save(draft());
    store.clear();
    expect(store.load()).toBeNull();
  });

  it("does nothing at all when there is no storage", () => {
    const store = createDraftStore(null);
    expect(store.available).toBe(false);
    expect(() => store.save(draft())).not.toThrow();
    expect(store.load()).toBeNull();
  });
});

describe("draftMatches", () => {
  const now = { fileName: "a.pdf", fileSize: 10, cardCount: 3, cellCount: 20 };

  it("matches the same file and the same extraction", () => {
    expect(draftMatches(draft(now), now)).toBe(true);
  });

  // Values are keyed by card number and taxonomy row. Those mean one thing for
  // one PDF and something else for another, so every part of the fingerprint
  // has to agree before a draft is even offered.
  it.each([
    ["a different file name", { fileName: "b.pdf" }],
    ["a different file size", { fileSize: 11 }],
    ["a different number of cards", { cardCount: 4 }],
    ["a different number of cells", { cellCount: 21 }],
  ])("refuses %s", (_label, change) => {
    expect(draftMatches(draft({ ...now, ...change }), now)).toBe(false);
  });
});

describe("counting and dating a draft", () => {
  it("counts every value across every card", () => {
    expect(countValues(draft())).toBe(3);
  });

  it("describes how old it is in words a person can act on", () => {
    const now = Date.now();
    expect(describeAge(now - 5_000, now)).toBe("just now");
    expect(describeAge(now - 8 * 60_000, now)).toBe("8 minutes ago");
    expect(describeAge(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(describeAge(now - 50 * 3_600_000, now)).toBe("2 days ago");
  });
});
