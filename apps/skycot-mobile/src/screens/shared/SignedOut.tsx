/**
 * The Mac says this device isn't linked any more: a grown-up removed it there, turned the
 * Family profile off, changed the parent code (grown-ups' phones), or the 30-day sign-in ran
 * out. Nothing more can be done from here than linking again.
 */
import { View } from "react-native";

import { useLinks, type Mac } from "../../links/store";
import { Button, EmptyState, Fill } from "../../ui/kit";

export function SignedOut(props: { readonly macs: ReadonlyArray<Mac> }) {
  const links = useLinks();
  const names = props.macs.map((mac) => mac.macName).join(" and ");
  return (
    <Fill>
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
        <EmptyState
          pose="oops"
          title="This device isn't linked any more"
          body={`${names} signed this device out. A grown-up can link it again from the Mac: Settings › Family › Phones and iPads.`}
        >
          <Button
            title="Link again"
            onPress={() => {
              for (const mac of props.macs) void links.forget(mac.macId);
            }}
            style={{ alignSelf: "stretch", marginTop: 12 }}
          />
        </EmptyState>
      </View>
    </Fill>
  );
}
