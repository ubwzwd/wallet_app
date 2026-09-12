/**
 * Jest manual mock for `lucide-react-native` (picked up automatically for node_modules).
 *
 * The package resolves to `dist/esm/*.mjs` under the "react-native" export condition, and
 * this project's jest transform covers neither `.mjs` nor that package, so importing the
 * real module throws a syntax error. Metro bundles it fine, so this is a test-only shim:
 * every icon renders as a plain View that keeps the props the UI layer sets.
 */
'use strict';

const React = require('react');
const { View } = require('react-native');

const cache = new Map();

function iconComponent(name) {
  let Component = cache.get(name);
  if (!Component) {
    Component = React.forwardRef(function LucideIcon(props, ref) {
      const { size, color, strokeWidth, testID, ...rest } = props;
      return React.createElement(View, {
        ref,
        testID,
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no',
        style: { width: size, height: size },
        // Kept as plain props so tests can assert what an icon was asked to draw.
        'data-icon': name,
        'data-color': color,
        'data-stroke-width': strokeWidth,
        ...rest,
      });
    });
    Component.displayName = name;
    cache.set(name, Component);
  }
  return Component;
}

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === '__esModule') return true;
      if (typeof prop !== 'string') return undefined;
      if (prop === 'default' || prop === 'then') return undefined;
      return iconComponent(prop);
    },
    has() {
      return true;
    },
  },
);
