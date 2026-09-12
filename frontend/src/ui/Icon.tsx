/**
 * Icon set (04 §6.2, tokens `icons`): a 20px grid, 1.9 stroke, round caps, colour inherited
 * from the surrounding text unless overridden. lucide-react-native draws with
 * react-native-svg, so the same component works on web and native.
 */
import React from 'react';
import {
  Archive,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Banknote,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CreditCard,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  Funnel,
  House,
  Info,
  KeyRound,
  Landmark,
  Languages,
  Link,
  List,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Tag,
  Trash,
  TriangleAlert,
  Undo2,
  Unlink,
  Upload,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react-native';
import type { SourceType, TxKind } from '@/api/types';
import { icons } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';

/**
 * Names are the stable lucide kebab-case spellings; lucide v1 renamed a few components
 * (house/funnel/trash/triangle-alert/ellipsis), which is why the map is not a 1:1 rename.
 */
export const ICONS = {
  home: House,
  list: List,
  plus: Plus,
  upload: Upload,
  user: User,
  settings: Settings,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'undo-2': Undo2,
  'arrow-left-right': ArrowLeftRight,
  'credit-card': CreditCard,
  wallet: Wallet,
  banknote: Banknote,
  landmark: Landmark,
  search: Search,
  filter: Funnel,
  x: X,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-left': ChevronLeft,
  calendar: Calendar,
  copy: Copy,
  download: Download,
  'trash-2': Trash,
  pencil: Pencil,
  link: Link,
  unlink: Unlink,
  'alert-triangle': TriangleAlert,
  info: Info,
  'refresh-cw': RefreshCw,
  'log-out': LogOut,
  eye: Eye,
  'eye-off': EyeOff,
  'more-horizontal': Ellipsis,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  languages: Languages,
  users: Users,
  'key-round': KeyRound,
  archive: Archive,
  tag: Tag,
} as const;

export type IconName = keyof typeof ICONS;

/** The four transaction kinds (decision §1) always carry an icon, never colour alone. */
export const KIND_ICON: Readonly<Record<TxKind, IconName>> = {
  expense: 'arrow-down',
  income: 'arrow-up',
  refund: 'undo-2',
  transfer: 'arrow-left-right',
};

/** The four account types (decision §14.48). */
export const SOURCE_TYPE_ICON: Readonly<Record<SourceType, IconName>> = {
  checking: 'landmark',
  credit: 'credit-card',
  cash: 'banknote',
  other: 'wallet',
};

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  testID?: string;
}

export function Icon({ name, size, color, strokeWidth, testID }: IconProps): React.JSX.Element {
  const colors = useColors();
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size ?? icons.grid}
      color={color ?? colors['fg.primary']}
      strokeWidth={strokeWidth ?? icons.stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      testID={testID}
    />
  );
}
