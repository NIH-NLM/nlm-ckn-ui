const Pagination = ({ currentPage, totalPages, paginate }) => {
  const pageNumbers = [];
  const delta = 2; // Number of pages to show around the current page
  const start = Math.max(2, currentPage - delta);
  const end = Math.min(totalPages - 1, currentPage + delta);

  // Always include the first page
  pageNumbers.push(1);

  // Insert ellipsis if there is a gap between first page and start of range
  if (start > 2) {
    pageNumbers.push("ellipsis-start");
  }

  // Add page numbers in range
  for (let i = start; i <= end; i++) {
    pageNumbers.push(i);
  }

  // Insert ellipsis if there is a gap between end of range and last page
  if (end < totalPages - 1) {
    pageNumbers.push("ellipsis-end");
  }

  // Always include the last page if there is more than one page
  if (totalPages > 1) {
    pageNumbers.push(totalPages);
  }

  return (
    <div className="pagination">
      <button onClick={() => paginate(currentPage - 1)} disabled={currentPage === 1}>
        Prev
      </button>
      {pageNumbers.map((item, index) =>
        item.toString().includes("ellipsis") ? (
          <span key={index} className="pagination-ellipsis">
            ...
          </span>
        ) : (
          <button
            key={index}
            onClick={() => paginate(item)}
            className={currentPage === item ? "active" : ""}
          >
            {item}
          </button>
        ),
      )}
      <button onClick={() => paginate(currentPage + 1)} disabled={currentPage === totalPages}>
        Next
      </button>
    </div>
  );
};

export default Pagination;
