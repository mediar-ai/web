/**
 * UI Fixes for Radix UI components
 */

/**
 * Fix for Radix UI dropdown menus leaving pointer-events: none on body
 * This causes the UI to freeze when clicking outside dropdowns
 * Call this when closing dropdowns or after menu item selection
 */
export const removeBodyPointerEvents = () => {
  // Remove pointer-events: none from body
  document.body.style.pointerEvents = '';

  // Also check for any data attributes that might be blocking interaction
  document.body.removeAttribute('data-scroll-locked');
  document.body.removeAttribute('data-radix-popper-content-wrapper');

  // Ensure body is not stuck with aria-hidden
  const ariaHiddenElements = document.querySelectorAll('[aria-hidden="true"]');
  ariaHiddenElements.forEach(element => {
    // Only remove from root-level elements that shouldn't be hidden
    if (element === document.body || element.parentElement === document.body) {
      element.removeAttribute('aria-hidden');
    }
  });
};

/**
 * Cleanup function to run when dropdown closes
 * Ensures all interaction blockers are removed
 */
export const cleanupDropdownClose = () => {
  // Use requestAnimationFrame to ensure DOM has updated
  requestAnimationFrame(() => {
    removeBodyPointerEvents();
  });
};