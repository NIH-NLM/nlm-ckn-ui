import { act, renderHook } from "@testing-library/react";
import { useSearch } from "./useSearch";

jest.mock("services", () => ({ searchDocuments: jest.fn() }));
jest.mock("utils", () => ({ getAllSearchableFields: () => new Set(["label"]) }));

import { searchDocuments } from "services";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Type a term and let the debounce fire.
const type = async (result, value) => {
  act(() => result.current.setQuery(value));
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
};

describe("useSearch", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    searchDocuments.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("applies only the latest response when an older one arrives last", async () => {
    const first = deferred();
    const second = deferred();
    searchDocuments.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSearch("phenotypes"));

    await type(result, "t");
    await type(result, "t cell");
    await act(async () => second.resolve([{ _id: "CL/0000084" }]));
    await act(async () => first.resolve([{ _id: "CL/0000000" }]));

    expect(result.current.results).toEqual([{ _id: "CL/0000084" }]);
    expect(result.current.isLoading).toBe(false);
  });

  it("opens the dropdown as soon as a search starts, so the loading state shows", () => {
    searchDocuments.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSearch("phenotypes"));

    act(() => result.current.setQuery("lung"));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isOpen).toBe(true);
  });

  it("aborts the previous request when the term changes", async () => {
    searchDocuments.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSearch("phenotypes"));

    await type(result, "t");
    const firstSignal = searchDocuments.mock.calls[0][3];
    expect(firstSignal.aborted).toBe(false);
    await type(result, "t cell");

    expect(firstSignal.aborted).toBe(true);
    expect(searchDocuments.mock.calls[1][3].aborted).toBe(false);
  });

  it("drops a response that arrives after the search was cleared", async () => {
    const pending = deferred();
    searchDocuments.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useSearch("phenotypes"));

    await type(result, "t cell");
    act(() => result.current.clearSearch());
    await act(async () => pending.resolve([{ _id: "CL/0000084" }]));

    expect(result.current.results).toEqual([]);
    expect(result.current.isOpen).toBe(false);
    expect(searchDocuments.mock.calls[0][3].aborted).toBe(true);
  });

  it("treats a response that is not a list as no results", async () => {
    searchDocuments.mockResolvedValueOnce({ detail: "unexpected" });
    const { result } = renderHook(() => useSearch("phenotypes"));

    await type(result, "t cell");

    expect(result.current.results).toEqual([]);
  });

  it("sets error and stops loading when the latest request rejects", async () => {
    searchDocuments.mockRejectedValueOnce(new Error("503"));
    const { result } = renderHook(() => useSearch("phenotypes"));

    await type(result, "t cell");

    expect(result.current.error).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.results).toEqual([]);
    expect(result.current.isOpen).toBe(true);
  });

  it("ignores a rejection from a stale request", async () => {
    const first = deferred();
    const second = deferred();
    searchDocuments.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSearch("phenotypes"));

    await type(result, "t");
    await type(result, "t cell");
    await act(async () => first.reject(new Error("aborted")));

    expect(result.current.error).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it("clears error on a new query, on success and on clearSearch", async () => {
    searchDocuments
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce([{ _id: "CL/0" }])
      .mockRejectedValueOnce(new Error("503"));
    const { result } = renderHook(() => useSearch("phenotypes"));

    await type(result, "a");
    expect(result.current.error).toBe(true);
    act(() => result.current.setQuery("ab"));
    expect(result.current.error).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(result.current.error).toBe(false);

    await type(result, "abc");
    expect(result.current.error).toBe(true);
    act(() => result.current.clearSearch());
    expect(result.current.error).toBe(false);
  });
});
