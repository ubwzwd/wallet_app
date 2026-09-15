/**
 * Popover: the wide-layout dropdown panel (04 §6.4), anchored under a trigger.
 *
 * Why a Modal and not an absolutely positioned sibling: react-native-web gives every View
 * `position: relative; z-index: 0`, so each View is its own stacking context and a panel's
 * own `zIndex` only wins against its siblings *inside the anchor*. The anchor itself is
 * painted in DOM order, and every field that follows it in the form paints on top — the
 * panel showed up behind the next input, looking empty. A Modal is portalled to the root,
 * above everything, and its full-screen backdrop is what closes the panel on an outside
 * click. The panel is placed at the trigger's measured window position; when the trigger
 * has not been measured (the first frame, or a test renderer) it falls back to a plain
 * floating card so its content is still there.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  type StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';

/** Gap between the trigger's bottom edge and the panel. */
const OFFSET = 4;
/** Below this much room under the trigger, the panel opens above it instead. */
const MIN_ROOM_BELOW = 240;
const VIEWPORT_MARGIN = 16;

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  /** The trigger's host view; measured on every open so the panel follows layout changes. */
  anchorRef: React.RefObject<View | null>;
  /** Accessible name of the backdrop ("close …"). */
  closeLabel: string;
  /** Prefix for the `-backdrop` / `-panel` test ids. */
  testID: string;
  /** Extra panel style (gap, max width, …); the card look itself is the popover's. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function Popover({
  open,
  onClose,
  anchorRef,
  closeLabel,
  testID,
  style,
  children,
}: PopoverProps): React.JSX.Element | null {
  const colors = useColors();
  const window = useWindowDimensions();
  const [rect, setRect] = React.useState<Rect | null>(null);

  React.useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    const node = anchorRef.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((x, y, width, height) => {
      // A test renderer reports nothing usable; keep the floating fallback then.
      if (width > 0 && height > 0) setRect({ x, y, width, height });
    });
  }, [open, anchorRef, window.width, window.height]);

  if (!open) return null;

  let placement: ViewStyle;
  if (rect === null) {
    placement = styles.floating;
  } else {
    const roomBelow = window.height - (rect.y + rect.height + OFFSET) - VIEWPORT_MARGIN;
    const roomAbove = rect.y - OFFSET - VIEWPORT_MARGIN;
    const openAbove = roomBelow < MIN_ROOM_BELOW && roomAbove > roomBelow;
    placement = openAbove
      ? {
          position: 'absolute',
          bottom: window.height - rect.y + OFFSET,
          left: rect.x,
          width: rect.width,
          maxHeight: Math.max(120, roomAbove),
        }
      : {
          position: 'absolute',
          top: rect.y + rect.height + OFFSET,
          left: rect.x,
          width: rect.width,
          maxHeight: Math.max(120, roomBelow),
        };
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        testID={`${testID}-backdrop`}
        style={StyleSheet.absoluteFill}
      />
      <View
        testID={`${testID}-panel`}
        style={[
          styles.panel,
          {
            backgroundColor: colors['bg.raised'],
            borderColor: colors['border.default'],
            shadowColor: colors['fg.primary'],
          },
          placement,
          style,
        ]}
      >
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space['2'],
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    overflow: 'hidden',
  },
  floating: { margin: VIEWPORT_MARGIN, alignSelf: 'stretch' },
});
