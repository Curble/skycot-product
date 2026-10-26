/**
 * The sticker book: the engine's own record (`/api/skycot/badges`), in the plain client's
 * words (features/badges/catalog.ts). Stickers are never taken away.
 */
import { View } from "react-native";

import { BADGE_COPY, earnedDate } from "../../../../nondev/src/features/badges/catalog";
import { useChild } from "../../app/child/ChildContext";
import { readStickers, useFamilyRead } from "../../data/hooks";
import { Button, Card, ChildLoading, EmptyState, Page, Symbol, Txt } from "../../ui/kit";
import { useGridBasis } from "../../ui/layout";
import { useTheme } from "../../ui/theme";

export function StickersScreen() {
  const theme = useTheme();
  const child = useChild();
  const mac = child.macs[0] ?? null;
  const book = useFamilyRead(mac, readStickers, 60_000, "stickers");
  const grid = useGridBasis();
  if (book.loading) return <ChildLoading onRetry={() => void book.refresh()} />;
  const view = book.value?.book ?? null;
  if (view === null) {
    return (
      <Page>
        {book.problem ? (
          <EmptyState title="That didn't work just now.">
            <Button title="Try again" onPress={() => void book.refresh()} />
          </EmptyState>
        ) : (
          <EmptyState
            pose="yay"
            title="No stickers yet"
            body="Make something and see what you find!"
          />
        )}
      </Page>
    );
  }
  const found = view.badges.filter((badge) => badge.earned !== null).length;
  return (
    <Page>
      <Txt variant="subheadline" tone="label2" style={{ marginHorizontal: 20, marginTop: 4 }}>
        {found === 0
          ? "No stickers yet. Make something and see what you find!"
          : `${found} found so far. Every sticker comes from something you did.`}
      </Txt>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 12,
          marginHorizontal: 16,
          marginTop: 16,
        }}
      >
        {view.badges.map((badge) => {
          const copy = BADGE_COPY[badge.id];
          const earned = badge.earned !== null;
          return (
            <Card
              key={badge.id}
              style={{
                flexBasis: grid,
                flexGrow: 1,
                alignItems: "center",
                gap: 6,
                opacity: earned ? 1 : 0.75,
              }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: earned ? theme.color.marker : theme.color.fill,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Symbol
                  name={earned ? "star.fill" : "star"}
                  size={32}
                  color={earned ? "#B5541F" : theme.color.label3}
                />
              </View>
              <Txt variant="headline" center>
                {copy.title}
              </Txt>
              <Txt variant="footnote" tone="label2" center>
                {earned ? `Found ${earnedDate(badge.earned!.at)}` : copy.hint}
              </Txt>
              {!earned && badge.progress ? (
                <Txt variant="caption" tone="label3">
                  {`${badge.progress.have} of ${badge.progress.need}`}
                </Txt>
              ) : null}
            </Card>
          );
        })}
      </View>
    </Page>
  );
}
