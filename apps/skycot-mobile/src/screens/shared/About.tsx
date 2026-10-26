// nondev-seam: skycot-iphone-q39-about
/**
 * About SKYCOT: the version, Curble's copyright, and the credit and licence T3 Code's MIT
 * licence asks for (docs/legal/t3code-attribution-and-licensing.md). T3's names appear only to
 * say where the software comes from; none of their marks, icons or addresses are used.
 */
import Constants from "expo-constants";
import { useState } from "react";
import { View } from "react-native";

import { useOptionalChild } from "../../app/child/ChildContext";
import { CHILD_ABOUT_COPY } from "./aboutCopy";
import { MIT_LICENCE_T3_CODE, NOT_AFFILIATED } from "../../legal/licences";
import { Mascot, Row, Section, Sheet, Txt } from "../../ui/kit";

export function AboutContent() {
  const child = useOptionalChild();
  const [licence, setLicence] = useState(false);
  const version = Constants.expoConfig?.version ?? "0.1.0";
  if (child !== null) {
    return (
      <View style={{ alignItems: "center", gap: 10, padding: 20 }}>
        <Mascot pose="hello" size={96} />
        <Txt variant="title2">{CHILD_ABOUT_COPY.title}</Txt>
        <Txt center>{CHILD_ABOUT_COPY.sam}</Txt>
        <Txt tone="label2" center>
          {CHILD_ABOUT_COPY.privacy}
        </Txt>
      </View>
    );
  }
  return (
    <View>
      <View style={{ alignItems: "center", gap: 6, paddingTop: 12 }}>
        <Mascot pose="hello" size={96} />
        <Txt variant="title2">SKYCOT</Txt>
        <Txt tone="label2">Version {version}</Txt>
        <Txt variant="footnote" tone="label2" center>
          A friendly place to build with Sam.
        </Txt>
      </View>
      <Section footer="Your family's work stays on your Mac. SKYCOT has no account or ads. Each day, we count app update checks and relay connections without names or account details. Totals reset daily. Update counts stop when updates are turned off or when Do Not Track or Global Privacy Control is on.">
        <Row title="Made by" detail="Curble Pty Ltd" />
        <Row title="Copyright" subtitle="© 2026 Curble Pty Ltd, trading as SKYCOT." />
      </Section>
      <Section title="Based on T3 Code" footer={NOT_AFFILIATED}>
        <Row
          title="Based on T3 Code (MIT) by T3 Tools Inc."
          subtitle="© 2026 T3 Tools Inc. · MIT licence"
        />
        <Row title="The MIT licence" chevron onPress={() => setLicence(true)} />
      </Section>
      <Sheet
        visible={licence}
        title="MIT licence"
        onClose={() => setLicence(false)}
        closeLabel="Done"
      >
        <Txt variant="footnote" style={{ fontFamily: "Menlo" }} selectable>
          {MIT_LICENCE_T3_CODE}
        </Txt>
      </Sheet>
    </View>
  );
}

export function AboutSheet(props: { readonly visible: boolean; readonly onClose: () => void }) {
  return (
    <Sheet visible={props.visible} title="About SKYCOT" onClose={props.onClose} closeLabel="Done">
      <AboutContent />
    </Sheet>
  );
}
