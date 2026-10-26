import { useEffect, useState } from "react";
import { get, post } from "./api.js";
import { Icon } from "./ui.jsx";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

export default function PushToggle({ notify }) {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setSupported(false);
      return;
    }
    get("/push/status")
      .then((r) => setSubscribed(Boolean(r.subscribed)))
      .catch(() => {});
  }, []);

  async function enable() {
    setBusy(true);
    setHint("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setHint("Разрешение не выдано — включи уведомления в настройках браузера");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const { publicKey } = await get("/push/key");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await post("/push/subscribe", { subscription: sub.toJSON() });
      setSubscribed(true);
      notify("Уведомления включены");
    } catch (err) {
      setHint(err.message || "Не удалось включить");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      setSubscribed(false);
      notify("Уведомления выключены");
    } catch (err) {
      setHint(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await post("/push/test", {});
      notify(r.sent ? "Тестовое уведомление отправлено" : "Нет активных подписок", r.sent ? "ok" : "err");
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  }

  const iosNeedsInstall = isIOS() && !isStandalone();

  return (
    <section className="card">
      <div className="row between" style={{ gap: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span className="notif-icon">
            <Icon name="bell" size={18} />
          </span>
          <div>
            <strong style={{ fontSize: 14 }}>Уведомления</strong>
            <div className="tiny muted">
              {subscribed ? "Включены — напомним за 15 минут до пары" : "Напомним за 15 минут до пары, если не отметился"}
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`switch${subscribed ? " on" : ""}`}
          onClick={subscribed ? disable : enable}
          disabled={busy || !supported || iosNeedsInstall}
          aria-pressed={subscribed}
          aria-label="Переключатель уведомлений"
        >
          <span />
        </button>
      </div>

      {!supported && (
        <p className="tiny muted mt">Браузер не поддерживает push. Попробуй Chrome, Safari 16+ или установи приложение.</p>
      )}
      {iosNeedsInstall && (
        <p className="tiny muted mt">
          На iPhone уведомления работают только после установки: «Поделиться» → «На экран Домой».
        </p>
      )}
      {hint && <p className="tiny mt" style={{ color: "var(--warn)" }}>{hint}</p>}

      {subscribed && (
        <button type="button" className="link mt" onClick={test} disabled={busy}>
          Отправить тестовое уведомление
        </button>
      )}
    </section>
  );
}
