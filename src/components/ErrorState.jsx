/**
 * ErrorState — shared component for data-loading failure screens.
 *
 * Usage:
 *   <ErrorState
 *     title="Could not load prices"
 *     message="Check your connection and try again."
 *     onRetry={() => fetchPrices()}
 *   />
 *
 * Props:
 *   title    {string}   Primary error heading (required)
 *   message  {string}   Secondary detail text (optional)
 *   onRetry  {Function} If provided, shows a Retry button (optional)
 *   compact  {boolean}  Reduces padding for inline use inside cards (optional)
 */
export default function ErrorState({ title, message, onRetry, compact = false }) {
  return (
    <div className={compact ? "error-state error-state--compact" : "error-state"} role="alert">
      <div className="error-state__icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 2" opacity="0.25" />
          <path d="M20 12v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="20" cy="27" r="1.5" fill="currentColor" />
        </svg>
      </div>

      <div className="error-state__body">
        <p className="error-state__title">{title}</p>
        {message && <p className="error-state__message">{message}</p>}
      </div>

      {onRetry && (
        <button
          type="button"
          className="error-state__retry"
          onClick={onRetry}
        >
          {/* Single-language app — i18n not required. */}
          {"Try again"}
        </button>
      )}
    </div>
  );
}
