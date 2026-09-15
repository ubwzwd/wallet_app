/** Jest config: jest-expo preset (React Native runtime + Testing Library). */
module.exports = {
  // Bound the worker pool: several jest runs share this machine (parallel orchestrator
  // worktrees plus the dev server), and the default of CPUs-1 workers each has taken
  // the whole WSL VM down with it twice. Four workers keep a run well under a few GB.
  maxWorkers: 4,
  workerIdleMemoryLimit: '768MB',
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // lucide-react-native ships ESM (.mjs) under the "react-native" export condition, so it
  // must be transformed like the other RN packages instead of being mocked away.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|lucide-react-native)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'node'],
  transform: { '\\.[cm]?[jt]sx?$': 'babel-jest' },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
