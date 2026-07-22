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
  createPattern,
  createRedactionClass,
  createRule,
  deletePattern,
  deleteRedactionClass,
  deleteRule,
  getHealth,
  getInternalDocs,
  getLogs,
  getPatterns,
  getRedactionClasses,
  getRules,
  getStats,
  getTools,
  postInternalDoc,
  postLogDecision,
  postToolDecision,
  updatePattern,
  updateRule,
} from "./client";
import type {
  AiTool,
  AuditRecord,
  DetectionPattern,
  DetectionPatternRequest,
  InternalDocUploadRequest,
  InternalDocUploadResponse,
  LogDecisionRequest,
  LogsPage,
  LogsQuery,
  RedactionClass,
  RedactionClassRequest,
  RuleRequest,
  RuleRow,
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

export function useRedactionClassesQuery() {
  return useQuery({
    queryKey: ["redaction"] as const,
    queryFn: getRedactionClasses,
    refetchInterval: POLL_MS,
  });
}

export function usePatternsQuery() {
  return useQuery({
    queryKey: ["patterns"] as const,
    queryFn: getPatterns,
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
              ? {
                  ...row,
                  status: body.approve ? "approved" : "denied",
                  reviewer: "Sarah Chong",
                  reviewed_at: new Date().toISOString(),
                  remark: body.remark,
                }
              : row,
          ),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
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

export function useCreateRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation<RuleRow, Error, RuleRequest>({
    mutationFn: createRule,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
  });
}

export function useUpdateRuleMutation() {
  const queryClient = useQueryClient();

  return useOptimisticMutation<{ id: number; body: RuleRequest }, RuleRow>({
    mutationFn: ({ id, body }) => updateRule(id, body),
    affectedQueryKey: ["rules"],
    applyOptimistic: ({ id, body }) => {
      queryClient.setQueriesData<RuleRow[]>({ queryKey: ["rules"] }, (old) =>
        old?.map((r) => (r.id === id ? { ...r, ...body } : r)));
    },
  });
}

export function useDeleteRuleMutation() {
  const queryClient = useQueryClient();

  return useOptimisticMutation<{ id: number }, { deleted: boolean }>({
    mutationFn: ({ id }) => deleteRule(id),
    affectedQueryKey: ["rules"],
    applyOptimistic: ({ id }) => {
      queryClient.setQueriesData<RuleRow[]>({ queryKey: ["rules"] }, (old) =>
        old?.filter((r) => r.id !== id));
    },
  });
}

export function useCreateRedactionClassMutation() {
  const queryClient = useQueryClient();

  return useMutation<RedactionClass, Error, RedactionClassRequest>({
    mutationFn: createRedactionClass,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["redaction"] });
    },
  });
}

export function useDeleteRedactionClassMutation() {
  const queryClient = useQueryClient();

  return useOptimisticMutation<{ id: number }, { deleted: boolean }>({
    mutationFn: ({ id }) => deleteRedactionClass(id),
    affectedQueryKey: ["redaction"],
    applyOptimistic: ({ id }) => {
      queryClient.setQueriesData<RedactionClass[]>({ queryKey: ["redaction"] }, (old) =>
        old?.filter((r) => r.id !== id));
    },
  });
}

export function useCreatePatternMutation() {
  const queryClient = useQueryClient();

  return useMutation<DetectionPattern, Error, DetectionPatternRequest>({
    mutationFn: createPattern,
    onSuccess: () => {
      // Creating a pattern also auto-adds its class to the Redaction list
      // server-side -- invalidate both so the "Always Redact" list reflects
      // that immediately.
      void queryClient.invalidateQueries({ queryKey: ["patterns"] });
      void queryClient.invalidateQueries({ queryKey: ["redaction"] });
    },
  });
}

export function useUpdatePatternMutation() {
  const queryClient = useQueryClient();

  return useOptimisticMutation<{ id: number; body: DetectionPatternRequest }, DetectionPattern>({
    mutationFn: ({ id, body }) => updatePattern(id, body),
    affectedQueryKey: ["patterns"],
    applyOptimistic: ({ id, body }) => {
      queryClient.setQueriesData<DetectionPattern[]>({ queryKey: ["patterns"] }, (old) =>
        old?.map((p) => (p.id === id ? { ...p, ...body } : p)));
    },
  });
}

export function useDeletePatternMutation() {
  const queryClient = useQueryClient();

  return useOptimisticMutation<{ id: number }, { deleted: boolean }>({
    mutationFn: ({ id }) => deletePattern(id),
    affectedQueryKey: ["patterns"],
    applyOptimistic: ({ id }) => {
      queryClient.setQueriesData<DetectionPattern[]>({ queryKey: ["patterns"] }, (old) =>
        old?.filter((p) => p.id !== id));
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
