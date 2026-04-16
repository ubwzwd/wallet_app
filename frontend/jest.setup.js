/**
 * Minimal Jest setup file.
 *
 * Defines __DEV__ global required by react-native modules without loading the
 * full expo/winter runtime (which fails due to missing react-native-worklets
 * peer dependency in this environment).
 */
'use strict';

// react-native requires __DEV__ to be defined globally
if (typeof global.__DEV__ === 'undefined') {
  global.__DEV__ = true;
}
