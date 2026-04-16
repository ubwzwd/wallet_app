module.exports = function(api) {
  api.cache(() => process.env.NODE_ENV);
  const isTest = process.env.NODE_ENV === 'test';
  const plugins = [
    [
      'module-resolver',
      {
        root: ['./'],
        alias: {
          '@': './src',
        },
      },
    ],
  ];
  // Skip reanimated plugin in test environment — react-native-worklets peer dep
  // is not installed; static analysis tests do not need the Babel transform.
  if (!isTest) {
    plugins.push('react-native-reanimated/plugin');
  }
  return {
    presets: [
      [
        'babel-preset-expo',
        // Disable automatic reanimated plugin injection in test mode
        isTest ? { reanimated: false } : {},
      ],
    ],
    plugins,
  };
};

