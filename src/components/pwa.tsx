"use client";

import { BellOff, BellRing, Download, Share } from "lucide-react";
import { useEffect, useState } from "react";
import { removePushSubscriptionAction, savePushSubscriptionAction } from "@/app/actions";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    }
  }, []);
  return null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Enable/disable push notifications on this device. */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState<PushSubscription | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      setSupported(true);
      navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription().then(setSubscribed)).catch(() => undefined);
    }
  }, []);

  if (!publicKey) return <p className="text-sm text-muted">Push needs VAPID keys on the server (run <code>npm run vapid</code>).</p>;
  if (!supported) {
    return <p className="text-sm text-muted">This browser doesn&apos;t support push here. On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), then open it from there.</p>;
  }

  async function enable() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Notifications are blocked for this site in your browser settings.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey!) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await savePushSubscriptionAction(json, navigator.userAgent);
      setSubscribed(sub);
      setMessage("This device will get alerts, approvals and the morning brief.");
    } catch (err) {
      setMessage(`Couldn't enable push: ${(err as Error).message}`);
    }
  }

  async function disable() {
    if (!subscribed) return;
    await removePushSubscriptionAction(subscribed.endpoint);
    await subscribed.unsubscribe();
    setSubscribed(null);
    setMessage("Push turned off on this device.");
  }

  return (
    <div className="space-y-2">
      {subscribed ? (
        <button type="button" className="btn" onClick={disable}>
          <BellOff className="h-4 w-4" aria-hidden /> Turn off on this device
        </button>
      ) : (
        <button type="button" className="btn btn-primary" onClick={enable}>
          <BellRing className="h-4 w-4" aria-hidden /> Enable notifications on this device
        </button>
      )}
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Install button (Chrome/Edge/Android) or Home Screen instructions (iOS Safari). */
export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(true);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone) return null;
  if (deferred) {
    return (
      <button
        type="button"
        className="btn"
        onClick={async () => {
          await deferred.prompt();
          setDeferred(null);
        }}
      >
        <Download className="h-4 w-4" aria-hidden /> Install the app
      </button>
    );
  }
  if (ios) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Share className="h-3.5 w-3.5" aria-hidden /> Install: tap Share, then “Add to Home Screen”.
      </p>
    );
  }
  return null;
}
