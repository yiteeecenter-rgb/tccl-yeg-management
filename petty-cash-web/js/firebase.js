import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import firebaseConfig from "./config.js";

const app     = initializeApp(firebaseConfig);
const db      = getFirestore(app);
const storage = getStorage(app);

// ── RECORDS ──────────────────────────────────────────────────
export async function saveRecord(data) {
  const ref_ = await addDoc(collection(db, "records"), {
    ...data,
    createdAt: serverTimestamp(),
    status: "pending"
  });
  return ref_.id;
}

export async function updateRecord(id, data) {
  await updateDoc(doc(db, "records", id), data);
}

export async function deleteRecord(id) {
  await deleteDoc(doc(db, "records", id));
}

export async function getRecord(id) {
  const snap = await getDoc(doc(db, "records", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getAllRecords() {
  const q    = query(collection(db, "records"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── UNITS ────────────────────────────────────────────────────
export async function getUnits() {
  const snap = await getDocs(collection(db, "units"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function saveUnit(data)       { return (await addDoc(collection(db, "units"), data)).id; }
export async function updateUnit(id, data) { await updateDoc(doc(db, "units", id), data); }
export async function deleteUnit(id)       { await deleteDoc(doc(db, "units", id)); }

// ── STATIONS ─────────────────────────────────────────────────
export async function getStations() {
  const snap = await getDocs(collection(db, "stations"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function saveStation(data)       { return (await addDoc(collection(db, "stations"), data)).id; }
export async function updateStation(id, data) { await updateDoc(doc(db, "stations", id), data); }
export async function deleteStation(id)       { await deleteDoc(doc(db, "stations", id)); }

// ── PHOTO UPLOAD ─────────────────────────────────────────────
export async function uploadPhoto(recordId, tripIndex, field, dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return "";
  const base64 = dataUrl.split(",")[1];
  const bytes  = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const path   = `records/${recordId}/trip${tripIndex}/${field}.jpg`;
  const r      = ref(storage, path);
  await uploadBytes(r, bytes, { contentType: "image/jpeg" });
  return await getDownloadURL(r);
}
