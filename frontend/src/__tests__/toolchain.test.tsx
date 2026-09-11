/**
 * Toolchain baseline: proves the jest-expo preset renders real components, that
 * expo-router's testing-library mounts a route tree, and that i18next works under jest.
 * Phase-5 tasks build on exactly these three capabilities (04 §8.3).
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { renderRouter, screen as routerScreen } from 'expo-router/testing-library';
import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';

function Counter() {
  const [n, setN] = React.useState(0);
  return (
    <Pressable onPress={() => setN((v) => v + 1)} testID="btn">
      <Text>count {n}</Text>
    </Pressable>
  );
}

test('jest-expo renders components and handles events', () => {
  render(<Counter />);
  expect(screen.getByText('count 0')).toBeTruthy();
  fireEvent.press(screen.getByTestId('btn'));
  expect(screen.getByText('count 1')).toBeTruthy();
});

test('expo-router testing-library mounts a route tree at a URL', async () => {
  const Login = () => <Text>login page</Text>;
  const Home = () => <Text>home page</Text>;
  renderRouter({ index: Home, login: Login }, { initialUrl: '/login' });
  expect(await routerScreen.findByText('login page')).toBeTruthy();
});

test('i18next key fallback works through react-i18next', async () => {
  await i18next.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: 'zh',
    ns: ['errors'],
    defaultNS: 'errors',
    resources: { zh: { errors: { unknown: '出错了（{{detail}}）' } } },
    interpolation: { escapeValue: false },
  });
  function C() {
    const { t } = useTranslation();
    return <Text>{t(['errors:nope', 'errors:unknown'], { detail: 'x' })}</Text>;
  }
  render(<C />);
  expect(screen.getByText('出错了（x）')).toBeTruthy();
});
