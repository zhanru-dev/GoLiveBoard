"use client";

import type { Me } from "@goliveboard/contracts";
import { createContext, useContext } from "react";

const MeContext = createContext<Me | null>(null);

export const MeProvider = MeContext.Provider;

/** The signed-in user, loaded by the (app) layout on the server. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (me === null) {
    throw new Error("useMe() is only available inside the signed-in app");
  }
  return me;
}
