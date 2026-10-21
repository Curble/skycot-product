import { HomeView } from "../features/home/HomeView";

export function HomeRoute({ showBack = false }: { readonly showBack?: boolean }) {
  return <HomeView showBack={showBack} />;
}
