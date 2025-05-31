// Mock chrome API
global.chrome = {
  runtime: {
    getURL: jest.fn(path => `chrome-extension://mock-extension-id/${path}`),
    id: 'mock-extension-id',
    onInstalled: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    sendMessage: jest.fn(),
    onConnect: {
      addListener: jest.fn(),
    },
  },
  storage: {
    local: {
      get: jest.fn((keys, callback) => callback({})),
      set: jest.fn((items, callback) => callback && callback()),
      remove: jest.fn((keys, callback) => callback && callback()),
      clear: jest.fn(callback => callback && callback()),
    },
    sync: {
      get: jest.fn((keys, callback) => callback({})),
      set: jest.fn((items, callback) => callback && callback()),
      remove: jest.fn((keys, callback) => callback && callback()),
      clear: jest.fn(callback => callback && callback()),
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  tabs: {
    query: jest.fn((query, callback) => callback([{ id: 1, url: 'https://example.com' }])),
    update: jest.fn((tabId, updateProperties, callback) => callback && callback()),
    create: jest.fn((properties, callback) => callback && callback()),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  action: {
    setIcon: jest.fn((details, callback) => callback && callback()),
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
    },
  },
  webNavigation: {
    onBeforeRequest: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  commands: {
    onCommand: {
      addListener: jest.fn(),
    },
  },
};

// Mock window and document objects
global.window = {
  location: {
    href: 'https://example.com',
    hostname: 'example.com',
  },
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  postMessage: jest.fn(),
  crypto: {
    getRandomValues: jest.fn(arr => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    }),
    subtle: {
      encrypt: jest.fn(),
      decrypt: jest.fn(),
      sign: jest.fn(),
      verify: jest.fn(),
      digest: jest.fn(),
      generateKey: jest.fn(),
      deriveKey: jest.fn(),
      deriveBits: jest.fn(),
      importKey: jest.fn(),
      exportKey: jest.fn(),
      wrapKey: jest.fn(),
      unwrapKey: jest.fn(),
    },
  },
};

global.document = {
  createElement: jest.fn(tagName => ({
    setAttribute: jest.fn(),
    style: {},
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      toggle: jest.fn(),
      contains: jest.fn(),
    },
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })),
  getElementById: jest.fn(() => ({
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    style: {},
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })),
  querySelector: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  createTextNode: jest.fn(text => ({ nodeValue: text })),
};

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn(key => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: jest.fn(key => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

global.localStorage = localStorageMock;
global.sessionStorage = { ...localStorageMock };

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  })
);

// Mock console methods
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Mock timers
const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;

global.setTimeout = jest.fn((fn, delay) => {
  const id = originalSetTimeout(fn, delay);
  global.setTimeout.mock.timers = global.setTimeout.mock.timers || new Map();
  global.setTimeout.mock.timers.set(id, { fn, delay, type: 'timeout' });
  return id;
});

global.setTimeout.mock = { timers: new Map() };

global.clearTimeout = jest.fn(id => {
  originalClearTimeout(id);
  if (global.setTimeout.mock.timers) {
    global.setTimeout.mock.timers.delete(id);
  }
});

global.setInterval = jest.fn((fn, interval) => {
  const id = originalSetInterval(fn, interval);
  global.setInterval.mock.timers = global.setInterval.mock.timers || new Map();
  global.setInterval.mock.timers.set(id, { fn, interval, type: 'interval' });
  return id;
});

global.setInterval.mock = { timers: new Map() };

global.clearInterval = jest.fn(id => {
  originalClearInterval(id);
  if (global.setInterval.mock.timers) {
    global.setInterval.mock.timers.delete(id);
  }
});

// Helper to advance timers
global.advanceTimersByTime = (ms) => {
  jest.advanceTimersByTime(ms);
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  
  // Reset storage mocks
  chrome.storage.local.get.mockImplementation((keys, callback) => callback({}));
  chrome.storage.local.set.mockImplementation((items, callback) => callback && callback());
  chrome.storage.sync.get.mockImplementation((keys, callback) => callback({}));
  chrome.storage.sync.set.mockImplementation((items, callback) => callback && callback());
  
  // Reset localStorage
  localStorage.clear();
  
  // Reset fetch
  fetch.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    })
  );
  
  // Reset timers
  jest.useRealTimers();
});

// Helper to wait for promises to resolve
global.flushPromises = () => new Promise(setImmediate);

// Mock the TextEncoder and TextDecoder
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
