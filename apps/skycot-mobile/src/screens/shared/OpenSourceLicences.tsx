// nondev-seam: skycot-iphone-c8-notices-screen
/**
 * Settings › Open-source licences: SKYCOT's own licence and the T3 Code credit first, then every
 * third-party package the app ships (src/legal/openSourceNotices.json, made by
 * `licences:generate` and checked against the installed dependencies by its test).
 */
import { useMemo, useState } from "react";
import { View } from "react-native";

import { Row, Section, Sheet, Txt } from "../../ui/kit";

interface Notice {
  readonly name: string;
  readonly version?: string;
  readonly license: string;
  readonly text: string;
}

interface NoticeFile {
  readonly own: ReadonlyArray<Notice>;
  readonly packages: ReadonlyArray<Notice & { readonly text: string }>;
  readonly texts: Readonly<Record<string, string>>;
}

/** Loaded when the screen opens, so the notice text is not parsed during ordinary startup. */
function loadNotices(): { own: Notice[]; packages: Notice[] } {
  const file = require("../../legal/openSourceNotices.json") as NoticeFile;
  return {
    own: [...file.own],
    packages: file.packages.map((p) => ({ ...p, text: file.texts[p.text] ?? "" })),
  };
}

function NoticeRow(props: { readonly notice: Notice; readonly onOpen: (notice: Notice) => void }) {
  const { notice } = props;
  return (
    <Row
      title={notice.name}
      subtitle={[notice.version, notice.license].filter(Boolean).join(" · ")}
      chevron
      accessibilityLabel={`${notice.name}, ${notice.license} licence`}
      onPress={() => props.onOpen(notice)}
    />
  );
}

export function OpenSourceLicencesSheet(props: {
  readonly visible: boolean;
  readonly onClose: () => void;
}) {
  const notices = useMemo(() => (props.visible ? loadNotices() : null), [props.visible]);
  const [selected, setSelected] = useState<Notice | null>(null);
  return (
    <Sheet
      visible={props.visible}
      title="Open-source licences"
      onClose={props.onClose}
      closeLabel="Done"
    >
      {notices === null ? null : (
        <View style={{ marginHorizontal: -16 }}>
          <Section
            title="SKYCOT"
            footer="SKYCOT is built on open-source software. Tap a name to read its licence."
            style={{ marginTop: 0 }}
          >
            {notices.own.map((n) => (
              <NoticeRow key={n.name} notice={n} onOpen={setSelected} />
            ))}
          </Section>
          <Section title={`Third-party packages (${notices.packages.length})`}>
            {notices.packages.map((n) => (
              <NoticeRow key={`${n.name}@${n.version}`} notice={n} onOpen={setSelected} />
            ))}
          </Section>
        </View>
      )}
      <Sheet
        visible={selected !== null}
        title={selected?.name ?? ""}
        onClose={() => setSelected(null)}
        closeLabel="Done"
      >
        <Txt tone="label2">
          {[selected?.version, selected?.license].filter(Boolean).join(" · ")}
        </Txt>
        <Txt variant="footnote" style={{ fontFamily: "Menlo" }} selectable>
          {selected?.text}
        </Txt>
      </Sheet>
    </Sheet>
  );
}
