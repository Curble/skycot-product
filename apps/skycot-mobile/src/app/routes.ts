/** The screens a stack can push, in either mode. */
// nondev-seam: skycot-ipad-routes
export type StackRoutes = {
  ChildHome: undefined;
  MyMakes: undefined;
  Fridge: undefined;
  Stickers: undefined;
  Requests: undefined;
  Children: undefined;
  RecapHome: undefined;
  ThisDevice: undefined;
  Conversation: {
    readonly macId: string;
    readonly threadId: string;
    readonly title: string;
    readonly readOnly?: boolean;
  };
  NewConversation: { readonly starterId?: string; readonly question?: boolean };
  Page: {
    readonly macId: string;
    readonly threadId: string;
    readonly page: string;
    readonly title: string;
  };
  ChildConversations: { readonly macId: string; readonly childId: string };
  Recap: { readonly macId: string; readonly childId: string };
  Demo: { readonly name: "plan" | "ask" | "made" };
  About: undefined;
  Macs: undefined;
};

export type StackRouteName = keyof StackRoutes;
