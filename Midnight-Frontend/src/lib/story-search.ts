import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { searchStories } from "@/lib/catalogue.functions";

/**
 * Live search for the header boxes. It asks the server (after a short pause in typing) instead of
 * searching a catalogue held in the browser; the server applies the same matching rules to every story.
 * `results` holds at most 8 stories, and `searching` is true while an answer is still on its way.
 */
export function useStorySearch(q: string, enabled = true) {
  const [settled, setSettled] = useState(q);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(q), 200);
    return () => window.clearTimeout(timer);
  }, [q]);
  const query = useQuery({
    queryKey: ["header-search", settled],
    queryFn: () => searchStories({ data: { q: settled, limit: 8 } }),
    enabled: enabled && settled.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const results = enabled && q ? (query.data?.results ?? []) : [];
  const searching = enabled && q.length > 0 && (q !== settled || query.isFetching);
  return { results, searching };
}
