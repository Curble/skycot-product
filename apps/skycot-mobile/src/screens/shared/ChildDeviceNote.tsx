/**
 * Version 1 of SKYCOT on iPhone is for grown-ups. A device the Mac linked as a child's gets this
 * friendly full-screen note instead of child screens, and can unlink itself.
 */
import { View } from "react-native";

import { childDeviceNote } from "../../app/childMode";
import { useMacData } from "../../data/MacData";
import { useLinks, type Mac } from "../../links/store";
import { Button, EmptyState, Fill } from "../../ui/kit";

export function ChildDeviceNote(props: { readonly macs: ReadonlyArray<Mac> }) {
  const links = useLinks();
  const { byMac } = useMacData();
  const name =
    props.macs
      .map((mac) => {
        const me = mac.me;
        if (me.kind !== "child") return null;
        return byMac[mac.macId]?.status?.children.find((child) => child.id === me.childId)?.name;
      })
      .find((entry) => entry !== undefined && entry !== null && entry !== "") ?? null;
  const note = childDeviceNote(name);
  return (
    <Fill>
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
        <EmptyState pose="hello" title={note.title} body={note.body}>
          <Button
            title={note.action}
            kind="tinted"
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
