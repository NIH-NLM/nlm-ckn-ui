import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter as Router } from "react-router-dom"; // Wrap with Router for routing context
import { ActiveNavProvider } from "../ActiveNavContext/ActiveNavContext"; // Assuming this is the context provider
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
    expect(screen.getByText(/Query/i)).toBeInTheDocument();
    expect(screen.getByText(/collections/i)).toBeInTheDocument();
    expect(screen.getByText(/Schema/i)).toBeInTheDocument();
  });

  test("sets active class for correct link based on location", () => {
    // Simulate different routes and check if the active class is applied to the correct link
    render(
      <Router initialEntries={["/aql"]}>
        <ActiveNavProvider>
          <Header />
        </ActiveNavProvider>
      </Router>,
    );

    expect(screen.getByText(/Query/i)).toHaveClass("active-nav"); // /aql should be active
    expect(screen.getByText(/Explore/i)).not.toHaveClass("active-nav");
  });

  test("updates active class when location changes by clicking a link", () => {
    render(
      <Router initialEntries={["/browse"]}>
        {" "}
        <ActiveNavProvider>
          <Header />
        </ActiveNavProvider>
      </Router>,
    );

    // Check the initial active class
    expect(screen.getByText(/collections/i)).toHaveClass("active-nav");
    expect(screen.getByText(/Explore/i)).not.toHaveClass("active-nav");

    // Simulate a click event on the "Schema" link to navigate to `/schema`
    fireEvent.click(screen.getByText(/Schema/i));

    // Check if the active class switches to the "Schema" link after the click
    expect(screen.getByText(/Schema/i)).toHaveClass("active-nav");
    expect(screen.getByText(/collections/i)).not.toHaveClass("active-nav");
  });
});
