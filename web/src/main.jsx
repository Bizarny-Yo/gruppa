import { StrictMode, createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { get } from "./api.js";
import { go, useRoute } from "./router.js";
import { Avatar, Icon, Spinner } from "./ui.jsx";
import Auth from "./screens/Auth.jsx";
import Today from "./screens/Today.jsx";
import Week from "./screens/Week.jsx";
import Lesson from "./screens/Lesson.jsx";
import Stats from "./screens/Stats.jsx";
import News from "./screens/News.jsx";
import Group from "./screens/Group.jsx";

/* ─────────────────────────── тосты ─────────────────────────── */

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

/* ─────────────────────────── каркас ─────────────────────────── */

const TABS = [
  { id: "today", path: "/", label: "Сегодня", icon: "clock" },
  { id: "week", path: "/week", label: "Неделя", icon: "calendar" },
  { id: "stats", path: "/stats", label: "Статистика", icon: "chart" },
  { id: "news", path: "/news", label: "Новости", icon: "bell" },
  { id: "group", path: "/group", label: "Группа", icon: "users" },
];

function Shell({ me, onLogout, onRefresh }) {
  const route = useRoute();
  const [toast, setToast] = useState(null);

  const notify = (message, kind = "ok") => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 2600);
  };

  const activeTab = route.name === "lesson" ? "today" : route.name;

  const screens = {
    today: <Today me={me} notify={notify} />,
    week: <Week me={me} notify={notify} />,
    lesson: <Lesson me={me} slotId={route.slotId} notify={notify} />,
    stats: <Stats me={me} />,
    news: <News me={me} notify={notify} />,
    group: <Group me={me} onLogout={onLogout} onRefresh={onRefresh} notify={notify} />,
  };

  return (
    <ToastContext.Provider value={notify}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <strong>{me.group.name}</strong>
            <span>
              {me.user.role === "starosta" ? "староста" : "студент"} · {me.group.students} чел.
            </span>
          </div>
          <ParityBadge parity={me.parity} />
          <button type="button" className="icon-btn" onClick={() => go("/group")} aria-label="Профиль">
            <Avatar name={me.user.name} color={me.user.color} size={26} />
          </button>
        </header>

        <main className="page">{screens[route.name] ?? screens.today}</main>

        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab${activeTab === t.id ? " active" : ""}`}
              onClick={() => go(t.path)}
            >
              <Icon name={t.icon} size={21} />
              {t.label}
            </button>
          ))}
        </nav>

        {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
      </div>
    </ToastContext.Provider>
  );
}

function ParityBadge({ parity }) {
  const even = parity === "even";
  return (
    <span className={`parity${even ? " even" : ""}`} title="Чётность учебной недели">
      {even ? "знаменатель" : "числитель"}
    </span>
  );
}

function App() {
  const [me, setMe] = useState(undefined);

  const load = () =>
    get("/me")
      .then(setMe)
      .catch(() => setMe(null));

  useEffect(() => {
    load();
  }, []);

  if (me === undefined) {
    return (
      <div className="auth">
        <Spinner text="Загружаем группу" />
      </div>
    );
  }

  if (me === null) return <Auth onAuth={setMe} />;

  return (
    <Shell
      me={me}
      onRefresh={load}
      onLogout={async () => {
        setMe(null);
      }}
    />
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
