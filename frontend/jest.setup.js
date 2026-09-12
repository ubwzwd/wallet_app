/* Global test setup for the jest-expo preset. */
'use strict';

// AsyncStorage has no native module under jest; use the official in-memory mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// 48 suites run in parallel, so a render can be starved for a second or more on a busy
// machine. Testing Library's 1 s default then times out a `waitFor` that the app would
// have satisfied — give async utils real headroom instead of chasing flakes.
const { configure } = require('@testing-library/react-native');
configure({ asyncUtilTimeout: 10000 });
