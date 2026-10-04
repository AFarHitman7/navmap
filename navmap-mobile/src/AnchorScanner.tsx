import React from 'react';
import { Pressable, Text, View } from 'react-native';

export type AnchorScannerProps = {
  /** Resolves with the decoded QR payload (navmap://...). Only used if P0 external-camera handoff failed. */
  scanAnchor: () => Promise<string>;
  onScanned: (payload: string) => void;
};

/** In-app QR fallback (ZXing bridge). Camera permission only on Scan tap. */
export function AnchorScanner({ scanAnchor, onScanned }: AnchorScannerProps): React.JSX.Element {
  const [error, setError] = React.useState<string | null>(null);
  return (
    <View testID="anchor-scanner">
      <Pressable
        testID="anchor-scan"
        accessibilityRole="button"
        accessibilityLabel="Scan QR"
        onPress={() => {
          setError(null);
          scanAnchor().then(onScanned, (e: unknown) =>
            setError(e instanceof Error ? e.message : 'scan failed — enter code manually'),
          );
        }}
      >
        <Text>Scan QR</Text>
      </Pressable>
      {error ? (
        <Text testID="anchor-error" accessibilityRole="alert">
          {error} — enter anchor code manually.
        </Text>
      ) : null}
    </View>
  );
}

export default AnchorScanner;
