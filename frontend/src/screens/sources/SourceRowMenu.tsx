/**
 * The 「···」 row menu of the account list (屏幕稿 09): 编辑 / 归档 / 删除.
 *
 * The mockup replaced the row's inline button pair with one overflow trigger at the end of
 * the row, so the three actions of 04 §4.8 moved in here — the confirmations themselves did
 * not change: archiving still goes through `useArchiveSource` (which previews the balance
 * leaving net worth) and deleting still asks the caller, which runs the double-tap confirm.
 *
 * Wide layouts drop the panel under the trigger (`Popover`), narrow ones open the same list
 * as a bottom `Sheet` — the split every overlay in the kit makes, by viewport width.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { FinanceSource } from '@/api/types';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, type IconName, Popover, Sheet, Text } from '@/ui';

import { useArchiveSource } from './useArchiveSource';

/** The trigger is a true 44 square — the mockup's last column (屏幕 09: 44px). */
export const MENU_TRIGGER = 44;
/** The dropdown is wider than its trigger, so it is pulled back to align on the right. */
const MENU_WIDTH = 216;

export interface SourceRowMenuProps {
  source: FinanceSource;
  /** My base currency — the archive confirmation names the balance leaving net worth in it. */
  baseCurrency: string;
  /** Opens the edit form. */
  onOpen(source: FinanceSource): void;
  /** Runs the §4.8 delete confirmation; the screen owns it (it also owns the 409 hint). */
  onDelete(source: FinanceSource): void;
  testID?: string;
}

interface MenuItem {
  key: string;
  testID: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  disabled?: boolean;
  run(): void;
}

export function SourceRowMenu({
  source,
  baseCurrency,
  onOpen,
  onDelete,
  testID,
}: SourceRowMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const archive = useArchiveSource(source.id, baseCurrency);
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<View>(null);
  const id = testID ?? `source-menu-${source.id}`;

  const items: MenuItem[] = [
    {
      key: 'edit',
      testID: `source-edit-${source.id}`,
      label: t('source:list.edit_action'),
      icon: 'pencil',
      run: () => onOpen(source),
    },
    {
      key: 'archive',
      testID: `source-archive-${source.id}`,
      label: source.archived
        ? t('source:list.unarchive_action')
        : t('source:list.archive_action'),
      icon: 'archive',
      disabled: archive.pending,
      run: () => void archive.setArchived(source, !source.archived),
    },
    {
      key: 'delete',
      testID: `source-delete-${source.id}`,
      label: t('source:list.delete_action'),
      icon: 'trash-2',
      danger: true,
      run: () => onDelete(source),
    },
  ];

  const list = (
    <View accessibilityRole="menu">
      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="menuitem"
          accessibilityLabel={item.label}
          accessibilityState={{ disabled: item.disabled ?? false }}
          disabled={item.disabled}
          testID={item.testID}
          onPress={() => {
            setOpen(false);
            item.run();
          }}
          style={({ pressed }) => ({
            minHeight: MENU_TRIGGER,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space['3'],
            paddingHorizontal: space['3'],
            borderRadius: radius.md,
            opacity: item.disabled === true ? 0.6 : 1,
            backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
          })}
        >
          <Icon
            name={item.icon}
            size={18}
            color={item.danger === true ? colors['status.danger.fg'] : colors['fg.secondary']}
          />
          <Text variant="body" weight={500} tone={item.danger === true ? 'danger' : 'primary'}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View ref={anchorRef} style={{ alignItems: 'flex-end' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('source:list.menu_label', { name: source.name })}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        testID={id}
        style={({ pressed }) => ({
          width: MENU_TRIGGER,
          height: MENU_TRIGGER,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
        })}
      >
        <Icon name="more-horizontal" size={18} color={colors['fg.muted']} />
      </Pressable>

      {wide ? (
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
          closeLabel={t('common:button.close')}
          testID={id}
          // The panel inherits the trigger's 44 width and its left edge; widening it and
          // pulling it back by the difference hangs it off the trigger's right edge.
          style={{ width: MENU_WIDTH, marginLeft: MENU_TRIGGER - MENU_WIDTH }}
        >
          {list}
        </Popover>
      ) : (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title={source.name}
          closeLabel={t('common:button.close')}
          testID={`${id}-sheet`}
        >
          {list}
        </Sheet>
      )}
    </View>
  );
}
