import { CloudOff, RotateCw } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

/** Shown in place of content when stories can't be fetched; never blanks the page. */
export function DataUnavailable({ title = "We couldn't load the news right now", text = "Our story database isn't reachable at the moment. Please try again shortly." }: { title?: string; text?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <div role="status" className="glass mx-auto my-6 flex max-w-xl flex-col items-center gap-3 rounded-[2rem] p-8 text-center">
      <CloudOff className="h-8 w-8 text-muted-foreground" />
      <h2 className="text-lg font-extrabold">{title}</h2>
      <p className="text-sm text-muted-foreground">{text}</p>
      <button onClick={async () => { await qc.invalidateQueries(); await router.invalidate(); }} className="action-pill">
        <RotateCw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}
