import { fetchWithErrorHandling } from "./fetchWrapper";

describe("fetchWithErrorHandling", () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
  });

  afterEach(() => {
    consoleError.mockRestore();
    delete global.fetch;
  });

  it("does not log a request the caller aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await fetchWithErrorHandling(
      "/search",
      { signal: controller.signal },
      { fallback: [] },
    );
    expect(result).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("still logs a network failure", async () => {
    await fetchWithErrorHandling("/search", {}, { fallback: [] });
    expect(consoleError).toHaveBeenCalled();
  });
});
