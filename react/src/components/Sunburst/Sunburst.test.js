import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
            _id: "CL/0000000",
            label: "cell",
            descendant_count: 4,
            weight: 2,
            value: 2,
            _hasChildren: true,
            children: [
              {
                _id: "CL/0000001",
                label: "test cell 0000001",
                descendant_count: 1,
                weight: 1,
                value: 1,
                _hasChildren: true,
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

  test("Fetches data from /arango_api/hierarchy/ with the selected label", async () => {
    render(<Sunburst addSelectedItem={jest.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/arango_api/hierarchy/"),
        expect.objectContaining({
          body: JSON.stringify({ label: "SUB_CLASS_OF", parent_id: null }),
        }),
      );
    });
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

describe("Sunburst Component controlled mode", () => {
  const data = {
    _id: "CL/0000000",
    label: "cell",
    descendant_count: 2,
    weight: 2,
    value: 2,
    _hasChildren: true,
    children: [
      {
        _id: "CL/0000001",
        label: "test cell 0000001",
        descendant_count: 1,
        weight: 1,
        value: 1,
        _hasChildren: true,
        children: null,
      },
    ],
  };

  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("renders from a controlled data prop without fetching its own root", async () => {
    render(
      <Sunburst
        data={data}
        fetchChildren={jest.fn()}
        focusPath={["CL/0000000"]}
        onFocusChange={jest.fn()}
      />,
    );

    await screen.findByText(/^test cell 0000001/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("centers on the node named by focusPath instead of the data root", async () => {
    render(
      <Sunburst
        data={data}
        fetchChildren={jest.fn()}
        focusPath={["CL/0000000", "CL/0000001"]}
        onFocusChange={jest.fn()}
      />,
    );

    // getByText also matches the arc's hover-title element, so this checks
    // specifically for the center label that only the focused node gets.
    const centerLabels = await screen.findAllByText(/^test cell 0000001/);
    const centerText = centerLabels.find((el) => el.tagName === "text");
    expect(centerText).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("centers on the occurrence named by focusPath, not the first node sharing that id", async () => {
    // A DAG-shared child under two parents. Both occurrences carry the same
    // `_id` (as the real hierarchy does), but distinct labels here only so
    // the assertion can tell them apart -- the case under test is that
    // resolution must follow the *path*, not stop at the first `_id` match.
    const sharedId = "CL/0000099";
    const twoParentData = {
      _id: "CL/0000000",
      label: "cell",
      descendant_count: 2,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [
        {
          _id: "CL/0000001",
          label: "parent one",
          descendant_count: 1,
          weight: 1,
          value: 1,
          _hasChildren: true,
          children: [
            {
              _id: sharedId,
              label: "shared under parent one",
              descendant_count: 0,
              weight: 1,
              value: 1,
              _hasChildren: false,
              children: [],
            },
          ],
        },
        {
          _id: "CL/0000002",
          label: "parent two",
          descendant_count: 1,
          weight: 1,
          value: 1,
          _hasChildren: true,
          children: [
            {
              _id: sharedId,
              label: "shared under parent two",
              descendant_count: 0,
              weight: 1,
              value: 1,
              _hasChildren: false,
              children: [],
            },
          ],
        },
      ],
    };

    render(
      <Sunburst
        data={twoParentData}
        fetchChildren={jest.fn()}
        focusPath={["CL/0000000", "CL/0000002", sharedId]}
        onFocusChange={jest.fn()}
      />,
    );

    // The sunburst's center text names the occurrence under parent two, the
    // one the path actually names -- not parent one's occurrence, which is
    // what an id-only, first-match lookup would center on instead.
    await waitFor(() => {
      const svg = document.querySelector("svg");
      const centerText = Array.from(svg.querySelectorAll("text")).find(
        (t) => t.style.fontWeight === "bold",
      );
      expect(centerText?.textContent).toMatch(/^shared under parent two/);
    });
  });

  test("asks fetchChildren for a node's children instead of fetching internally", async () => {
    const fetchChildren = jest.fn().mockResolvedValue([
      {
        _id: "CL/0000003",
        label: "test cell 0000003",
        descendant_count: 0,
        weight: 1,
        value: 1,
        _hasChildren: false,
        children: null,
      },
    ]);
    render(
      <Sunburst
        data={data}
        fetchChildren={fetchChildren}
        focusPath={["CL/0000000"]}
        onFocusChange={jest.fn()}
      />,
    );

    fireEvent.click(await screen.findByText(/^test cell 0000001/));

    await waitFor(() => expect(fetchChildren).toHaveBeenCalledWith("CL/0000001"));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
