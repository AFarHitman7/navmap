const React = require('react');

function host(type) {
  const C = (props) => React.createElement(type, props, props.children);
  C.displayName = type;
  return C;
}

const View = host('View');
const Text = host('Text');
const ScrollView = host('ScrollView');
const ActivityIndicator = host('ActivityIndicator');

function Pressable(props) {
  const { onPress, disabled, children, ...rest } = props;
  return React.createElement(
    'Pressable',
    { ...rest, onPress: disabled ? undefined : onPress, disabled },
    typeof children === 'function' ? children({ pressed: false }) : children,
  );
}

function TextInput(props) {
  const { onChangeText, ...rest } = props;
  return React.createElement('TextInput', {
    ...rest,
    onChangeText,
    // Bridge onChange events to onChangeText for DOM-style handlers.
    onChange: props.onChange ?? (onChangeText ? (e) => onChangeText(e.target.value) : undefined),
  });
}

function FlatList({ data = [], renderItem, keyExtractor, ...rest }) {
  const items = data.map((item, index) => {
    const key = keyExtractor ? keyExtractor(item, index) : String(index);
    return React.createElement(
      React.Fragment,
      { key },
      renderItem ? renderItem({ item, index }) : null,
    );
  });
  return React.createElement('FlatList', rest, ...items);
}

const StyleSheet = { create: (s) => s, flatten: (s) => s };

const Linking = {
  getInitialURL: async () => null,
  addEventListener: () => ({ remove: () => undefined }),
  removeEventListener: () => undefined,
};

const AppRegistry = { registerComponent: () => undefined };
const Platform = { OS: 'android', select: (o) => o.android ?? o.default };
const NativeModules = {};
class NativeEventEmitter {
  constructor() {}
  addListener() {
    return { remove: () => undefined };
  }
  removeAllListeners() {}
  emit() {}
}

module.exports = {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Linking,
  AppRegistry,
  Platform,
  NativeModules,
  NativeEventEmitter,
  Button: host('Button'),
};
