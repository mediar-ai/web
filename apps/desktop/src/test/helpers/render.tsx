/**
 * Custom Render Helper
 *
 * Wraps React Testing Library's render with common providers
 * and setup needed for testing components.
 */

import { render as rtlRender, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';

/**
 * Custom render function that wraps components with providers
 *
 * Add any global providers here (e.g., theme, context, router)
 */
export const customRender = (ui: ReactElement, options?: RenderOptions) => {
  // TODO: Add providers as needed
  // Example:
  // const Wrapper = ({ children }: { children: React.ReactNode }) => {
  //   return (
  //     <ThemeProvider>
  //       <AuthProvider>
  //         {children}
  //       </AuthProvider>
  //     </ThemeProvider>
  //   );
  // };

  return rtlRender(ui, options);
};

// Re-export everything except render from testing library
export * from '@testing-library/react';
