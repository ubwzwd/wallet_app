/* Global test setup for the jest-expo preset. */
'use strict';

// AsyncStorage has no native module under jest; use the official in-memory mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
