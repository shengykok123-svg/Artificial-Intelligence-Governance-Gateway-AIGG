// M6  TanStack Query hooks. refetchInterval 3s everywhere -- polling, no
// WebSockets, no SSE. TanStack Query IS the state manager; server data has
// exactly one home, here.

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import {
  getHealth,
  getInternalDocs,
  getLogs,
  getRules,
  getStats,
  getTools,
  postInternalDoc,
  postLogDecision,
  postToolDecision,
} from "./client";
import type {
  AiTool,
  AuditRecord,
  InternalDocUploadRequest,
  InternalDocUploadResponse,
  LogDecisionRequest,
  LogsPage,
  LogsQuery,
  ToolDecisionRequest,
} from "./types";

const POLL_MS = 3_000;

// -- Reads ---------------------------------------------------------------

export function useLogsQuery(query: LogsQuery) {
  return useQuery({
    queryKey: ["logs", query] as const,
    queryFn: () => getLogs(query),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData, // page doesn't blank out between polls
  });
}

export function useStatsQuery() {
  return useQuery({
    queryKey: ["stats"] as const,
    queryFn: getStats,
    refetchInterval: POLL_MS,
  });
}

export function useRulesQuery() {
  return useQuery({
    queryKey: ["rules"] as const,
    queryFn: getRules,
    refetchInterval: POLL_MS,
  });
}

export function useToolsQuery() {
  return useQuery({
    queryKey: ["tools"] as const,
    queryFn: getTools,
    refetchInterval: POLL_MS,
  });
}

export function useHealthQuery() {
  return useQuery({
    queryKey: ["health"] as const,
    queryFn: getHealth,
    refetchInterval: POLL_MS,
  });
}

export function useInternalDocsQuery() {
  return useQuery({
    queryKey: ["internal-docs"] as const,
    queryFn: getInternalDocs,
    refetchInterval: POLL_MS,
  });
}

// -- Writes ----------------------------------------------------------------
//
// Screens 2 (ApprovalQueue) and 4 (PolicyAndTools) share the exact same
// problem: an optimistic write racing the 3s poll. If a poll that was
// already on the wire lands AFTER the optimistic write, it silently reverts
// the row -- which looks exactly like the button did nothing. The fix is one
// hook, used by both, not solved twice:
//   1. cancel every in-flight query under the affected key before writing
//      the cache (onMutate), so a stale response can't land after us;
//   2. snapshot the previous cache so an error can roll back cleanly;
//   3. invalidate on settle, so the server's version is what we end up
//      trusting either way.

interface OptimisticMutationOptions<TVars, TResponse> {
  mutationFn: (vars: TVars) => Promise<TResponse>;
  affectedQueryKey: QueryKey; // prefix -- matches every filter variant
  applyOptimistic: (vars: TVars) => void;
}

function useOptimisticMutation<TVars, TResponse>({
  mutationFn,
  affectedQueryKey,
  applyOptimistic,
}: OptimisticMutationOptions<TVars, TResponse>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onMutate: async (vars: TVars) => {
      await queryClient.cancelQueries({ queryKey: affectedQueryKey });
      const snapshot = queryClient.getQueriesData({ queryKey: affectedQueryKey });
      applyOptimistic(vars);
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      context?.snapshot.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: affectedQueryKey });
    },
  });
}

export function useLogDecisionMutation() {
  const queryClient = useQueryClient();

  return useOptimisticMutation<{ logId: string; body: LogDecisionRequest }, AuditRecord>({
    mutationFn: ({ logId, body }) => postLogDecision(logId, body),
    affectedQueryKey: ["logs"],
    applyOptimistic: ({ logId, body }) => {
      queryClient.setQueriesData<LogsPage>({ queryKey: ["logs"] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((row) =>
            row.log_id === logId
              ? { ...row, status: body.approve ? "approved" : "denied", remark: body.remark }
              : row,
          ),
        };
      });
    },
  });
}

export function useToolDecisionMutation() {
  const queryClient = useQueryClient();

  return useOptimisticMutation<{ host: string; body: ToolDecisionRequest }, AiTool>({
    mutationFn: ({ host, body }) => postToolDecision(host, body),
    affectedQueryKey: ["tools"],
    applyOptimistic: ({ host, body }) => {
      queryClient.setQueriesData<AiTool[]>({ queryKey: ["tools"] }, (old) => {
        if (!old) return old;
        return old.map((t) => (t.host === host ? { ...t, status: body.status } : t));
      });
    },
  });
}

export function useInternalDocUploadMutation() {
  const queryClient = useQueryClient();

  return useMutation<InternalDocUploadResponse, Error, InternalDocUploadRequest>({
    mutationFn: postInternalDoc,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["internal-docs"] });
    },
  });
}
