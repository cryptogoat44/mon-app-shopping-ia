import { useEffect, useState } from "react";
import type { PostExtrasStatus } from "@monapp/shared-types";
import { onPostExtrasStatus, postExtrasStatus } from "./post-extras";

/** Plusieurs photos et identifications disponibles ? (lu par la mise en page commune, lib/api.ts). */
export function usePostExtrasStatus(): PostExtrasStatus {
  const [status, setStatus] = useState<PostExtrasStatus>(postExtrasStatus);
  useEffect(() => {
    setStatus(postExtrasStatus());
    return onPostExtrasStatus(setStatus);
  }, []);
  return status;
}
