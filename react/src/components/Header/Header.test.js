import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter as Router } from "react-router-dom"; // Wrap with Router for routing context
import { ActiveNavProvider } from "../../contexts/ActiveNavContext";
import Header from "./Header";

describe("Header Component", () => {
  test("renders without crashing", () => {
    render(
      <Router>
        <ActiveNavProvider>
          <Header />
        </ActiveNavProvider>
      </Router>,
    );
  });

  test("renders all navigation links", () => {
    render(
      <Router>
        <ActiveNavProvider>
          <Header />
        </ActiveNavProvider>
      </Router>,
    );

    // Check if each navigation link is rendered
    expect(screen.getByText(/Explore/i)).toBeInTheDocument();
    expect(screen.getByText(/collections/i)).toBeInTheDocument();
    expect(screen.getByText(/Graph/i)).toBeInTheDocument();
    expect(screen.getByText(/About/i)).toBeInTheDocument();
  });

  test("sets active class for correct link based on location", () => {
    // Simulate different routes and check if the active class is applied to the correct link
    render(
      <Router initialEntries={["/tree"]}>
        <ActiveNavProvider>
          <Header />
        </ActiveNavProvider>
      </Router>,
    );

    expect(screen.getByText(/Explore/i)).toHaveClass("active-nav"); // /tree should be active
    expect(screen.getByText(/collections/i)).not.toHaveClass("active-nav");
  });

  test("updates active class when location changes by clicking a link", () => {
    render(
      <Router initialEntries={["/collections"]}>
        {" "}
        <ActiveNavProvider>
          <Header />
        </ActiveNavProvider>
      </Router>,
    );

    // Check the initial active class
    expect(screen.getByText(/collections/i)).toHaveClass("active-nav");
    expect(screen.getByText(/Explore/i)).not.toHaveClass("active-nav");

    // Simulate a click event on the "Explore" link to navigate to `/tree`
    fireEvent.click(screen.getByText(/Explore/i));

    // Check if the active class switches to the "Explore" link after the click
    expect(screen.getByText(/Explore/i)).toHaveClass("active-nav");
    expect(screen.getByText(/collections/i)).not.toHaveClass("active-nav");
  });
});
