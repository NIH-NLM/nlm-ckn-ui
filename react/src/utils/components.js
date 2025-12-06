/**
 * Shared UI components used across the application.
 */

/**
 * Loading bar component with progress indicator.
 */
export const LoadingBar = () => {
  return (
    <div className="loading-indicator">
      <div className="progress-bar" />
      <span>Loading...</span>
    </div>
  );
};
