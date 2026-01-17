import '@testing-library/jest-dom'
import { randomFillSync } from 'crypto'
import { beforeAll, vi } from 'vitest'

// Mock Tauri APIs
beforeAll(() => {
  // jsdom doesn't come with a WebCrypto implementation
  Object.defineProperty(window, 'crypto', {
    value: {
      // @ts-ignore
      getRandomValues: (buffer: any) => {
        return randomFillSync(buffer)
      },
    },
  })

  // Mock Tauri internal APIs
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {
      invoke: vi.fn(),
      transformCallback: vi.fn(),
      PLUGINS: {},
    },
    configurable: true,
    writable: true,
  })

  // Mock Tauri IPC
  Object.defineProperty(window, '__TAURI_IPC__', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  })

  // Mock window location for testing
  Object.defineProperty(window, 'location', {
    value: {
      href: 'tauri://localhost',
      protocol: 'tauri:',
      host: 'localhost',
      hostname: 'localhost',
      origin: 'tauri://localhost',
    },
  })

  // Mock ResizeObserver
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }))

  // Mock IntersectionObserver
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }))

  // Mock matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

