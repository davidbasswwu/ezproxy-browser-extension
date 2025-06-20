module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest'
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^\\.(css|less|scss|sass)$': 'identity-obj-proxy'
  },
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/test-helpers.js'],
  transformIgnorePatterns: [
    '/node_modules/(?!(core-js|@babel)/)'
  ],
  testPathIgnorePatterns: [
    '/node_modules/'
  ],
  moduleFileExtensions: ['js', 'json', 'jsx', 'node'],
  globals: {
    chrome: 'readonly',
    browser: 'readonly',
  },
  testEnvironmentOptions: {
    url: 'https://example.com'
  }
};
