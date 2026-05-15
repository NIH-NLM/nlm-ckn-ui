import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider, useToast } from "./Toast";

jest.useFakeTimers();

// Helper component that triggers toasts
function Trigger({ content, duration }) {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() => showToast(content, duration !== undefined ? { duration } : undefined)}
    >
      show toast
    </button>
  );
}

function renderWithProvider(content, duration) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Trigger content={content} duration={duration} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("Toast", () => {
  afterEach(() => {
    jest.clearAllTimers();
    // Remove the portal mount point so it is recreated fresh each test
    const root = document.getElementById("toast-root");
    root?.parentNode?.removeChild(root);
  });

  it("renders a string message", () => {
    renderWithProvider("Hello toast");
    fireEvent.click(screen.getByRole("button", { name: /show toast/i }));
    expect(screen.getByText("Hello toast")).toBeInTheDocument();
  });

  it("renders JSX content", () => {
    renderWithProvider(<span data-testid="jsx-content">JSX toast</span>);
    fireEvent.click(screen.getByRole("button", { name: /show toast/i }));
    expect(screen.getByTestId("jsx-content")).toBeInTheDocument();
  });

  it("auto-dismisses after the default duration", () => {
    renderWithProvider("Auto dismiss", 4000);
    fireEvent.click(screen.getByRole("button", { name: /show toast/i }));
    expect(screen.getByText("Auto dismiss")).toBeInTheDocument();

    act(() => jest.advanceTimersByTime(4000));
    expect(screen.queryByText("Auto dismiss")).not.toBeInTheDocument();
  });

  it("can be manually dismissed before auto-dismiss", () => {
    renderWithProvider("Manual dismiss");
    fireEvent.click(screen.getByRole("button", { name: /show toast/i }));
    expect(screen.getByText("Manual dismiss")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss notification/i }));
    expect(screen.queryByText("Manual dismiss")).not.toBeInTheDocument();
  });

  it("stacks multiple toasts independently", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <Trigger content="First" duration={4000} />
          <Trigger content="Second" duration={8000} />
        </ToastProvider>
      </MemoryRouter>,
    );

    const [btn1, btn2] = screen.getAllByRole("button", { name: /show toast/i });
    fireEvent.click(btn1);
    fireEvent.click(btn2);

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();

    // Advance past first toast duration only
    act(() => jest.advanceTimersByTime(4000));
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("throws when useToast is called outside a provider", () => {
    // Suppress the error boundary output
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    function Bad() {
      useToast();
      return null;
    }
    expect(() => render(<Bad />)).toThrow("useToast must be used inside a ToastProvider");
    consoleSpy.mockRestore();
  });
});
