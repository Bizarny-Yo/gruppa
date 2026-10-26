import { StrictMode, createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { get } from "./api.js";
import { go, useRoute } from "./router.js";
import { Avatar, Icon, Spinner, Sheet } from "./ui.jsx";
import Auth from "./screens/Auth.jsx";
import Today from "./screens/Today.jsx";
import Week from "./screens/Week.jsx";
import Lesson from "./screens/Lesson.jsx";
import Stats from "./screens/Stats.jsx";
import Files from "./screens/Files.jsx";
import News from "./screens/News.jsx";
import Group from "./screens/Group.jsx";

/* ─────────────────────────── тосты ─────────────────────────── */

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

/* ─────────────────────────── каркас ─────────────────────────── */

const TABS = [
  { id: "today", path: "/", label: "Сегодня", icon: "clock" },
  { id: "week", path: "/week", label: "Неделя", icon: "calendar" },
  { id: "files", path: "/files", label: "Файлы", icon: "folder" },
  { id: "stats", path: "/stats", label: "Статистика", icon: "chart" },
  { id: "news", path: "/news", label: "Новости", icon: "bell" },
  { id: "group", path: "/group", label: "Группа", icon: "users" },
];

function Shell({ me, onLogout, onRefresh }) {
  const route = useRoute();
  const [toast, setToast] = useState(null);
  const [parityOpen, setParityOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    addEventListener("online", goOnline);
    addEventListener("offline", goOffline);
    return () => {
      removeEventListener("online", goOnline);
      removeEventListener("offline", goOffline);
    };
  }, []);

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
    files: <Files me={me} notify={notify} />,
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
              {me.group.profile ?? (me.user.role === "starosta" ? "староста" : "студент")} · {me.group.students} чел.
            </span>
          </div>
          <ParityBadge parity={me.parity} onClick={() => setParityOpen(true)} />
          <button type="button" className="icon-btn" onClick={() => go("/group")} aria-label="Профиль">
            <Avatar name={me.user.name} color={me.user.color} size={26} />
          </button>
        </header>

        {!online && <div className="offline-bar">Офлайн — показаны последние сохранённые данные</div>}

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

        <Sheet open={parityOpen} onClose={() => setParityOpen(false)} title="Учебная неделя">
          <p style={{ marginTop: 0, fontSize: 14 }}>
            Идёт <strong>{me.week}-я учебная неделя</strong> —{" "}
            <strong>{me.parity === "even" ? "чётная" : "нечётная"}</strong>.
          </p>

          <p className="tiny muted">
            Часть пар идёт не каждую неделю, а через одну:
          </p>

          <div className="card" style={{ background: "var(--bg-2)", padding: 12, margin: "8px 0" }}>
            <div className="row between" style={{ fontSize: 13 }}>
              <span>Нечётная неделя</span>
              <span className="muted">1, 3, 5, 7…</span>
            </div>
            <div className="row between" style={{ fontSize: 13, marginTop: 6 }}>
              <span>Чётная неделя</span>
              <span className="muted">2, 4, 6, 8…</span>
            </div>
          </div>

          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Отсчёт идёт от начала семестра, а не от календаря — поэтому номер недели может
            не совпадать с тем, что видно в других сервисах. Пара с пометкой «чётная» или
            «нечётная» показывается только в свою неделю.
          </p>
        </Sheet>

        {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
      </div>
    </ToastContext.Provider>
  );
}

function ParityBadge({ parity, onClick }) {
  const even = parity === "even";
  return (
    <button
      type="button"
      className={`parity${even ? " even" : ""}`}
      onClick={onClick}
      title="Чётность учебной недели — нажми, чтобы узнать подробнее"
    >
      {even ? "чётная" : "нечётная"}
      <Icon name="right" size={11} />
    </button>
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
        try {
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch {
          /* кэш не критичен */
        }
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
