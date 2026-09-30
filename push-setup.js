/* ============================================================
   push-setup.js — ขอสิทธิ์แจ้งเตือนและบันทึก subscription ลง Supabase
   ============================================================ */

// public key เท่านั้น (ไม่ใช่ความลับ ฝังในหน้าเว็บได้ปกติ)
const VAPID_PUBLIC_KEY = 'BHzW5Y23aVd2B2-ryNwrhFtoQWairOLbMp0HyXAqA7-gjSttwQx0SatC3Y-HFZo0PPDFd5sBU2BQ5v1HtroAQ-w';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function isPushEnabled() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub && Notification.permission === 'granted';
  } catch (e) { return false; }
}

async function enablePushNotifications(sb, myUserId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('อุปกรณ์/เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนแบบ push');
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('ไม่ได้รับอนุญาตให้แจ้งเตือน — เปิดสิทธิ์ Notification ในเบราว์เซอร์แล้วลองใหม่');
      return false;
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const j = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({
      user_id: myUserId,
      endpoint: j.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth,
    }, { onConflict: 'endpoint' });

    if (error) { console.error('บันทึก push subscription ไม่สำเร็จ:', error); return false; }
    return true;
  } catch (err) {
    console.error('เปิดการแจ้งเตือนไม่สำเร็จ:', err);
    alert('เปิดการแจ้งเตือนไม่สำเร็จ: ' + err.message);
    return false;
  }
}
