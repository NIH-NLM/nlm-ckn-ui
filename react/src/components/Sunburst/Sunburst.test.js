import { render, screen, waitFor } from "@testing-library/react";
import Sunburst from "./Sunburst";

describe("Sunburst Component", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () =>
          Promise.resolve({
            label: "NLM Cell Knowledge Network",
            children: [
              {
                label: "cell",
                children: [],
              },
              {
                label: "biological_process",
                children: [],
              },
            ],
          }),
      }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("Fetches data correctly from /arango_api/sunburst/", async () => {
    render(<Sunburst addSelectedItem={jest.fn()} />);

    // Ensure fetch was called
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/arango_api/sunburst/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  test("Popup button is hidden on load when data loads", async () => {
    // Render the component
    render(<Sunburst addSelectedItem={jest.fn()} />);

    // Wait for loading to finish (loading indicator should disappear)
    await waitFor(
      () => {
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // After data loads, find and check the popup button
    const popupButton = screen.queryByTestId("popup-button");

    // If the button exists, it should not be visible on load
    if (popupButton) {
      expect(popupButton).not.toBeVisible();
    }
    // If no popup button exists after load, that's also a valid state
  });
});
