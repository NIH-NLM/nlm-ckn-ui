import { createContext, useCallback, useContext, useReducer } from "react";
import { createPortal } from "react-dom";

// ---- Context ----------------------------------------------------------------

const ToastContext = createContext(null);

// ---- Reducer ----------------------------------------------------------------

function toastReducer(state, action) {
  switch (action.type) {
    case "ADD":
      return [...state, action.toast];
    case "REMOVE":
      return state.filter((t) => t.id !== action.id);
    default:
      return state;
  }
}

// ---- Provider ---------------------------------------------------------------

export function ToastProvider({ children }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);

  const showToast = useCallback((content, { duration = 4000 } = {}) => {
    const id = Date.now() + Math.random();
    dispatch({ type: "ADD", toast: { id, content, duration } });
    if (duration > 0) {
      setTimeout(() => dispatch({ type: "REMOVE", id }), duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    dispatch({ type: "REMOVE", id });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

// ---- Hook -------------------------------------------------------------------

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside a ToastProvider");
  }
  return ctx;
}

// ---- Portal container -------------------------------------------------------

function getToastRoot() {
  let el = document.getElementById("toast-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-root";
    document.body.appendChild(el);
  }
  return el;
}

function ToastContainer({ toasts, onRemove }) {
  if (!toasts.length) return null;

  return createPortal(
    <output className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast-item" role="alert">
          <div className="toast-content">{toast.content}</div>
          <button
            type="button"
            className="toast-dismiss"
            onClick={() => onRemove(toast.id)}
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      ))}
    </output>,
    getToastRoot(),
  );
}
