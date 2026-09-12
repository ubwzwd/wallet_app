/** Jest config: jest-expo preset (React Native runtime + Testing Library). */
module.exports = {
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
