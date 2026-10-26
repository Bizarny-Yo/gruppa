import { useEffect, useState } from "react";

export function parseRoute(pathname) {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (parts[0] === "week") return { name: "week" };
  if (parts[0] === "lesson" && parts[1]) return { name: "lesson", slotId: Number(parts[1]) };
  if (parts[0] === "stats") return { name: "stats" };
  if (parts[0] === "news") return { name: "news" };
  if (parts[0] === "group") return { name: "group" };
  return { name: "today" };
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  return route;
}

export function go(path) {
  if (location.pathname === path) return;
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}
