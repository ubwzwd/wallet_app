module.exports = function(api) {
  api.cache(() => process.env.NODE_ENV);
  const isTest = process.env.NODE_ENV === 'test';

  // Skip reanimated plugin if react-native-worklets peer dep is absent or in test mode.
  let reanimatedAvailable = false;
  if (!isTest) {
    try {
      require.resolve('react-native-worklets/plugin');
      reanimatedAvailable = true;
    } catch (_) {
      reanimatedAvailable = false;
    }
  }

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
  if (reanimatedAvailable) {
    plugins.push('react-native-reanimated/plugin');
  }
  return {
    presets: [
      [
        'babel-preset-expo',
        (!isTest && reanimatedAvailable) ? {} : { reanimated: false },
      ],
    ],
    plugins,
  };
};

