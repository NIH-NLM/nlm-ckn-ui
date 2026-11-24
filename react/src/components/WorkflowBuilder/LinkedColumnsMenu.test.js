import { fireEvent, render, screen } from "@testing-library/react";
import LinkedColumnsMenu from "components/WorkflowBuilder/LinkedColumnsMenu";

const interacts = { label: "MOLECULARLY_INTERACTS_WITH", collection: "PR" };
const produces = { label: "PRODUCES", collection: "GS" };

const renderMenu = (chosen, onChange = () => {}) =>
  render(
    <LinkedColumnsMenu
      options={[{ ...interacts, count: 1 }]}
      chosen={chosen}
      onChange={onChange}
      loadNextHop={() => [{ ...produces, count: 1 }]}
    />,
  );

it("offers a second hop under an expanded first hop and appends the path when ticked", () => {
  const onChange = jest.fn();
  renderMenu([], onChange);
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  expect(screen.getByText("Molecularly interacts with → Protein (1)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Expand Molecularly interacts with/ }));
  fireEvent.click(screen.getByLabelText("Produces → Gene symbol (1)"));
  expect(onChange).toHaveBeenCalledWith([{ path: [interacts, produces] }]);
});

it("removes a chosen column when unticked", () => {
  const onChange = jest.fn();
  renderMenu([{ path: [interacts] }], onChange);
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  fireEvent.click(screen.getByLabelText("Molecularly interacts with → Protein (1)"));
  expect(onChange).toHaveBeenCalledWith([]);
});

it("lists a chosen column the rows no longer offer so it can be removed", () => {
  const onChange = jest.fn();
  const gone = { label: "GONE", collection: "CL" };
  renderMenu([{ path: [gone] }], onChange);
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  fireEvent.click(screen.getByLabelText("Gone → Cell type (0)"));
  expect(onChange).toHaveBeenCalledWith([]);
});

it('keeps a missing label apart from the string "undefined"', () => {
  render(
    <LinkedColumnsMenu
      options={[
        { label: undefined, collection: "PR", count: 1 },
        { label: "undefined", collection: "PR", count: 1 },
      ]}
      chosen={[{ path: [{ label: undefined, collection: "PR" }] }]}
      onChange={() => {}}
      loadNextHop={() => []}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  const checked = screen.getAllByRole("checkbox").filter((box) => box.checked);
  expect(checked).toHaveLength(1);
});
