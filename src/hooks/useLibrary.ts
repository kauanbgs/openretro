import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bridge } from "../services/bridge";
export function useLibrary() {
  return useQuery({ queryKey: ["library"], queryFn: bridge.library });
}
export function useEmulators() {
  return useQuery({ queryKey: ["emulators"], queryFn: bridge.emulators });
}
export function useRefresh() {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["library"] }),
      client.invalidateQueries({ queryKey: ["emulators"] }),
    ]);
  };
}
