import { render, screen, waitFor } from "@testing-library/react";
import { fetchVersionInfo } from "services";
import Footer from "./Footer";

jest.mock("services", () => ({
  fetchVersionInfo: jest.fn(),
}));

describe("Footer Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchVersionInfo.mockResolvedValue(null);
  });

  test("renders without crashing", () => {
    render(<Footer />);
  });

  test("displays the UI and ETL versions when the fetch succeeds", async () => {
    fetchVersionInfo.mockResolvedValue({
      ui_version: "v1.0.0",
      etl_version: "v1.4.6-alpha.28",
    });

    render(<Footer />);

    expect(await screen.findByText(/v1\.0\.0/)).toBeInTheDocument();
    expect(await screen.findByText(/v1\.4\.6-alpha\.28/)).toBeInTheDocument();
  });

  test("still renders the footer when the version fetch fails", async () => {
    fetchVersionInfo.mockResolvedValue(null);

    render(<Footer />);

    expect(await screen.findByText(/National Library of Medicine/)).toBeInTheDocument();
  });

  test("does not render undefined when version keys are missing", async () => {
    fetchVersionInfo.mockResolvedValue({});

    render(<Footer />);

    await waitFor(() => expect(fetchVersionInfo).toHaveBeenCalled());
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});
