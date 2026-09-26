/**
 * 「共享到」: one chip per ledger I belong to (decision §14.62). A solid chip is a ledger this
 * account is shared into — its other members may record with it; a soft one is not shared.
 * I can always use my own account in any of my ledgers, so the chips only decide what the
 * *other* members see.
 *
 * Used by the account list (one row of chips per active account, each press a PUT / DELETE)
 * and by the account form (a multi-select whose diff is sent on save). Presentation only:
 * what "shared" means for a given chip, and what a press does, is the caller's.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { Ledger, Uuid } from '@/api/types';
import { space } from '@/theme/tokens';
import { Chip } from '@/ui';

export interface ShareChipsProps {
  ledgers: readonly Ledger[];
  isShared(ledgerId: Uuid): boolean;
  /** A request for this chip is in flight — it is disabled until the answer lands. */
  isPending?(ledgerId: Uuid): boolean;
  onToggle(ledger: Ledger): void;
  disabled?: boolean;
  /** Each chip is `${testID}-${ledgerId}`. */
  testID: string;
  style?: StyleProp<ViewStyle>;
}

export function ShareChips({
  ledgers,
  isShared,
  isPending,
  onToggle,
  disabled = false,
  testID,
  style,
}: ShareChipsProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] - 2 }, style]}
    >
      {ledgers.map((ledger) => {
        const shared = isShared(ledger.id);
        return (
          <Chip
            key={ledger.id}
            label={ledger.name}
            variant={shared ? 'solid' : 'soft'}
            // `selected` carries the state to assistive tech; the solid fill is the visual.
            selected={shared}
            disabled={disabled || (isPending?.(ledger.id) ?? false)}
            onPress={() => onToggle(ledger)}
            style={{ maxWidth: '100%' }}
            testID={`${testID}-${ledger.id}`}
          />
        );
      })}
    </View>
  );
}
