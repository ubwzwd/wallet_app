/**
 * Toast and confirmation dialog (04 §3.9) plus the bottom sheet: the imperative APIs that
 * replace `window.alert` / `Alert.alert`, with one implementation on both platforms.
 */
import React from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react-native';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { namespaces, resources } from '@/i18n/resources';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Sheet } from '@/ui/Sheet';
import { TOAST_DURATION, ToastHost, toast } from '@/ui/Toast';
import { ConfirmHost, confirm } from '@/ui/ConfirmDialog';

const CONFIRM_LABELS = { confirm: '确认', cancel: '取消', confirmAgain: '再点一次确认' };

// `Sheet` names its backdrop from the language pack, so the real one has to be loaded.
beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: 'zh',
      fallbackLng: 'zh',
      ns: [...namespaces],
      defaultNS: 'common',
      resources: resources as never,
      interpolation: { escapeValue: false },
    });
  }
});

function renderThemed(node: React.ReactElement) {
  return render(<ThemeProvider initialPref="light">{node}</ThemeProvider>);
}

describe('toast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    toast.clear();
  });
  afterEach(() => {
    act(() => {
      toast.clear();
    });
    jest.useRealTimers();
  });

  test('success disappears on its own after 4 seconds', () => {
    renderThemed(<ToastHost />);
    act(() => {
      toast.success('已保存');
    });
    expect(screen.getByText('已保存')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(TOAST_DURATION - 1);
    });
    expect(screen.getByText('已保存')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText('已保存')).toBeNull();
  });

  test('warning and info also expire, and the host unmounts when empty', () => {
    renderThemed(<ToastHost />);
    act(() => {
      toast.warning('超过可退金额');
      toast.info('已切换账本');
    });
    expect(screen.getByTestId('toast-host')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(TOAST_DURATION);
    });
    expect(screen.queryByTestId('toast-host')).toBeNull();
  });

  test('an error stays put, can expand its detail and is closed by hand', () => {
    renderThemed(<ToastHost closeLabel="关闭" detailLabel="展开详情" />);
    act(() => {
      toast.error('保存失败', { detail: 'stale_update' });
    });

    act(() => {
      jest.advanceTimersByTime(TOAST_DURATION * 3);
    });
    expect(screen.getByText('保存失败')).toBeTruthy();
    expect(screen.queryByTestId('toast-detail')).toBeNull();

    fireEvent.press(screen.getByLabelText('展开详情'));
    expect(screen.getByTestId('toast-detail')).toHaveTextContent('stale_update');

    fireEvent.press(screen.getByLabelText('关闭'));
    expect(screen.queryByText('保存失败')).toBeNull();
  });

  test('the live region is announced politely', () => {
    renderThemed(<ToastHost />);
    act(() => {
      toast.info('已切换账本');
    });
    expect(screen.getByTestId('toast-info').props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('confirm', () => {
  test('resolves true when confirmed and false when cancelled', async () => {
    renderThemed(<ConfirmHost labels={CONFIRM_LABELS} />);

    let accepted: Promise<boolean> | undefined;
    act(() => {
      accepted = confirm({ title: '撤销这次导入？', body: '会删掉本批 42 笔交易。' });
    });
    expect(screen.getByText('撤销这次导入？')).toBeTruthy();
    fireEvent.press(screen.getByTestId('confirm-accept'));
    await expect(accepted).resolves.toBe(true);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();

    let refused: Promise<boolean> | undefined;
    act(() => {
      refused = confirm({ title: '撤销这次导入？' });
    });
    fireEvent.press(screen.getByTestId('confirm-cancel'));
    await expect(refused).resolves.toBe(false);
  });

  test('a dangerous dialog can carry its own glyph and the batch it is about', async () => {
    renderThemed(<ConfirmHost labels={CONFIRM_LABELS} />);
    let result!: Promise<boolean>;
    act(() => {
      result = confirm({
        title: '撤销这批导入？',
        tone: 'danger',
        icon: 'undo-2',
        meta: 'dbs-09.csv · 导入于 09-09 08:02',
        body: '会删掉本批 11 笔交易。',
      });
    });
    expect(screen.getByText('撤销这批导入？')).toBeTruthy();
    expect(screen.getByTestId('confirm-meta')).toHaveTextContent('dbs-09.csv · 导入于 09-09 08:02');
    fireEvent.press(screen.getByTestId('confirm-cancel'));
    await expect(result).resolves.toBe(false);
  });

  test('requireText keeps the confirm button disabled until the word matches', async () => {
    renderThemed(<ConfirmHost labels={CONFIRM_LABELS} />);
    let result: Promise<boolean> | undefined;
    act(() => {
      result = confirm({ title: '删除账本', tone: 'danger', requireText: '我的账本' });
    });

    expect(screen.getByTestId('confirm-accept').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    fireEvent.press(screen.getByTestId('confirm-accept'));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('confirm-require-text'), '我的账');
    expect(screen.getByTestId('confirm-accept').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    fireEvent.changeText(screen.getByTestId('confirm-require-text'), '我的账本');
    expect(screen.getByTestId('confirm-accept').props.accessibilityState).toMatchObject({
      disabled: false,
    });
    fireEvent.press(screen.getByTestId('confirm-accept'));
    await expect(result).resolves.toBe(true);
  });

  test('doubleTap arms on the first press and confirms on the second', async () => {
    renderThemed(<ConfirmHost labels={CONFIRM_LABELS} />);
    let result: Promise<boolean> | undefined;
    act(() => {
      result = confirm({ title: '删除账户', tone: 'danger', doubleTap: true });
    });

    expect(screen.getByTestId('confirm-accept')).toHaveTextContent(CONFIRM_LABELS.confirm);
    fireEvent.press(screen.getByTestId('confirm-accept'));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByTestId('confirm-accept')).toHaveTextContent(CONFIRM_LABELS.confirmAgain);

    fireEvent.press(screen.getByTestId('confirm-accept'));
    await expect(result).resolves.toBe(true);
  });

  test('per-call labels win over the host defaults', () => {
    renderThemed(<ConfirmHost labels={CONFIRM_LABELS} />);
    act(() => {
      void confirm({ title: '退出账本', confirmLabel: '退出', cancelLabel: '留下' });
    });
    expect(screen.getByTestId('confirm-accept')).toHaveTextContent('退出');
    expect(screen.getByTestId('confirm-cancel')).toHaveTextContent('留下');
    fireEvent.press(screen.getByTestId('confirm-cancel'));
  });
});

describe('Sheet', () => {
  test('renders its title and children only while open', () => {
    const onClose = jest.fn();
    const { unmount } = renderThemed(
      <Sheet open={false} onClose={onClose} title="筛选" closeLabel="关闭">
        <></>
      </Sheet>,
    );
    expect(screen.queryByText('筛选')).toBeNull();
    unmount();

    renderThemed(
      <Sheet open onClose={onClose} title="筛选" closeLabel="关闭" testID="filters">
        <></>
      </Sheet>,
    );
    expect(screen.getByText('筛选')).toBeTruthy();
    fireEvent.press(screen.getByTestId('filters-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('filters-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('a header-less sheet still has a named backdrop (屏幕稿 02 · 交易筛选 375)', () => {
    // The filter sheet draws its own header, so it passes neither `title` nor `closeLabel`
    // and `Sheet` renders no header row — but the backdrop is still a `role="button"` and
    // an unnamed button is unreachable by voice control / a screen reader.
    renderThemed(
      <Sheet open onClose={jest.fn()} testID="filters">
        <></>
      </Sheet>,
    );
    expect(screen.queryByTestId('filters-close')).toBeNull();
    expect(screen.getByTestId('filters-backdrop').props.accessibilityLabel).toBe('关闭');
    expect(screen.getByLabelText('关闭')).toBeTruthy();
  });

  test('an explicit title or closeLabel still wins over the fallback', () => {
    const { unmount } = renderThemed(
      <Sheet open onClose={jest.fn()} title="筛选" testID="a">
        <></>
      </Sheet>,
    );
    expect(screen.getByTestId('a-backdrop').props.accessibilityLabel).toBe('筛选');
    unmount();

    renderThemed(
      <Sheet open onClose={jest.fn()} title="筛选" closeLabel="收起筛选" testID="b">
        <></>
      </Sheet>,
    );
    expect(screen.getByTestId('b-backdrop').props.accessibilityLabel).toBe('收起筛选');
  });
});
