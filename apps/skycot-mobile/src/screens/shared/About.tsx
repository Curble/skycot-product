/**
 * About SKYCOT: the version, Curble's copyright, and the credit and licence T3 Code's MIT
 * licence asks for (docs/legal/t3code-attribution-and-licensing.md). T3's names appear only to
 * say where the software comes from; none of their marks, icons or addresses are used.
 */
import Constants from "expo-constants";
import { useState } from "react";
import { View } from "react-native";

import { MIT_LICENCE_T3_CODE, NOT_AFFILIATED } from "../../legal/licences";
import { Mascot, Row, Section, Sheet, Txt } from "../../ui/kit";

export function AboutContent() {
  const [licence, setLicence] = useState(false);
  const version = Constants.expoConfig?.version ?? "0.1.0";
  return (
    <View>
      <View style={{ alignItems: "center", gap: 6, paddingTop: 12 }}>
        <Mascot pose="hello" size={96} />
        <Txt variant="title2">SKYCOT</Txt>
        <Txt tone="label2">Version {version}</Txt>
        <Txt variant="footnote" tone="label2" center>
          The cloud is SKYCOT too.
        </Txt>
      </View>
      <Section footer="SKYCOT keeps your family's work on your own Mac. No account or advertising. SKYCOT counts update checks and relay connections as anonymous daily totals. The count resets each UTC day and has no name or account attached. Do Not Track or Global Privacy Control opts out of update counting; turning off updates or the relay stops those requests.">
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
