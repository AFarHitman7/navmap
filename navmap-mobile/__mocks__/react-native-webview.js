const React = require('react');

function WebView(props) {
  return React.createElement('WebView', { ...props, children: undefined });
}

module.exports = { WebView, default: WebView };
