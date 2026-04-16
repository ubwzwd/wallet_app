module.exports = {
  // Static analysis tests — no React Native runtime needed.
  // Uses a lightweight node environment that avoids expo/winter and
  // react-native-worklets setup failures on this machine.
  testEnvironment: 'node',
  // Minimal setupFiles: only define __DEV__ without loading expo/winter
  // (which fails due to missing react-native-worklets peer dep).
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    '\\.[jt]sx?$': ['babel-jest', {
      caller: { name: 'metro', bundler: 'metro', platform: 'ios' },
      configFile: './babel.config.js',
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
