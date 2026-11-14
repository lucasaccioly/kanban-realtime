import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { API_URL } from "../api/client";

let awake = false; // once the server answered, stay "up" across pages

/** Polls GET /api/health every 3 s until the (possibly sleeping) Render server answers. */
export function useServerAwake(): "waking" | "up" {
  const [status, setStatus] = useState<"waking" | "up">(awake ? "up" : "waking");
  useEffect(() => {
    if (awake) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(10_000) });
        if (res.ok) {
          awake = true;
          if (!stopped) setStatus("up");
          return;
        }
      } catch {
        // still waking up
      }
      if (!stopped) timer = setTimeout(check, 3000);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return status;
}

export function WakingBanner() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <Loader2 size={16} className="animate-spin" />
      Acordando o servidor (até ~1 min)… você já pode olhar o quadro
    </div>
  );
}
