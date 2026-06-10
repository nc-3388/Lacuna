import 'fake-indexeddb/auto';
import { Dexie } from 'dexie';

const db = new Dexie('test');
db.version(1).stores({ assets: 'hash' });

async function main() {
  const blob = new Blob(['backup-image'], { type: 'image/png' });
  await db.assets.put({ hash: 'abc123', blob, mimeType: 'image/png', width: 1, height: 1, createdAt: 1 });
  const imported = await db.assets.get('abc123');
  console.log('typeof blob:', typeof imported.blob);
  console.log('blob constructor:', imported.blob?.constructor?.name);
  console.log('blob keys:', Object.keys(imported.blob || {}));
  console.log('has arrayBuffer:', typeof imported.blob?.arrayBuffer);
  console.log('has text:', typeof imported.blob?.text);
  console.log('is ArrayBuffer:', imported.blob instanceof ArrayBuffer);
  console.log('is Uint8Array:', imported.blob instanceof Uint8Array);
  console.log('ArrayBuffer.isView:', ArrayBuffer.isView(imported.blob));
  console.log('toString:', imported.blob?.toString?.());
  if (typeof imported.blob?.text === 'function') {
    console.log('text():', await imported.blob.text());
  }
  if (typeof imported.blob?.arrayBuffer === 'function') {
    try {
      const ab = await imported.blob.arrayBuffer();
      console.log('arrayBuffer len:', ab.byteLength);
      console.log('decoded:', new TextDecoder().decode(ab));
    } catch (e) {
      console.log('arrayBuffer error:', e.message);
    }
  }
  try {
    const ab = await new Response(imported.blob).arrayBuffer();
    console.log('Response arrayBuffer len:', ab.byteLength);
    console.log('Response decoded:', new TextDecoder().decode(ab));
  } catch (e) {
    console.log('Response error:', e.message);
  }
  try {
    const fr = new FileReader();
    const result = await new Promise((resolve, reject) => {
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('FileReader failed'));
      fr.readAsArrayBuffer(imported.blob);
    });
    console.log('FileReader len:', result.byteLength);
    console.log('FileReader decoded:', new TextDecoder().decode(result));
  } catch (e) {
    console.log('FileReader error:', e.message);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
