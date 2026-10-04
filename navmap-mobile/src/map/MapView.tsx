import React from 'react';
import { WebView } from 'react-native-webview';
import { buildLeafletHtml, type LeafletMapInput } from './leafletHtml';

export const MAP_USER_AGENT = 'NavMapPrototype/0.1 (Android)';

export type MapViewProps = LeafletMapInput & {
  onlineTiles?: boolean;
  onReady?: () => void;
};

/**
 * Offline-first map: bundled Leaflet + data-URI images, no local HTTP server.
 * OSM tiles are online-only (with attribution); never packaged for offline.
 */
export function MapView({ onlineTiles = false, onReady, ...input }: MapViewProps): React.JSX.Element {
  const html = React.useMemo(() => buildLeafletHtml({ ...input, onlineTiles }), [input, onlineTiles]);
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      userAgent={MAP_USER_AGENT}
      javaScriptEnabled
      domStorageEnabled={false}
      onLoadEnd={onReady}
    />
  );
}

export default MapView;
