import 'fake-indexeddb/auto';
import { Dexie } from 'dexie';
import { db } from './src/db/schema.js';
import {
  storeImageBlob,
  assetUrl,
  backupAssetToImageAsset,
  assetsForBackup,
  blobToText,
  blobToArrayBuffer,
  referencedAssetHashesInCards,
} from './src/db/assets.js';
import { createCard, createDeck } from './src/db/repository.js';
import { exportDatabase, importBackup } from './src/db/portability.js';

async function reset() {
  await Promise.all([
    db.decks.clear(),
    db.cards.clear(),
    db.assets.clear(),
    db.sessionHistory.clear(),
    db.userPerformance.clear(),
  ]);
}

async function main() {
  await reset();
  const deck = await createDeck('Images');
  const asset = await storeImageBlob(new Blob(['backup-image'], { type: 'image/png' }), 'image/png', 20, 12);
  await createCard(deck.id, 'front_back', `![scan](${assetUrl(asset.hash)})`, 'answer');

  console.log('Original blob type:', asset.blob.constructor.name);
  console.log('Original blob text:', await asset.blob.text());

  const backup = await exportDatabase();
  console.log('Backup assets count:', backup.assets.length);
  console.log('Backup asset data length:', backup.assets[0].data.length);

  const converted = backupAssetToImageAsset(backup.assets[0]);
  console.log('Converted blob type:', converted.blob.constructor.name);
  console.log('Converted blob text:', await converted.blob.text());

  await reset();
  await importBackup(backup, 'replace');

  const imported = await db.assets.get(asset.hash);
  console.log('Imported blob type:', imported?.blob?.constructor?.name);
  console.log('Imported blob keys:', Object.keys(imported?.blob || {}));
  console.log('Imported blob toString:', imported?.blob?.toString?.());
  console.log('Imported blob text:', typeof imported?.blob?.text === 'function' ? await imported.blob.text() : 'no text method');
  console.log('Imported blob arrayBuffer:', typeof imported?.blob?.arrayBuffer === 'function' ? (await imported.blob.arrayBuffer()).byteLength : 'no arrayBuffer method');
  console.log('blobToArrayBuffer result:', (await blobToArrayBuffer(imported.blob)).byteLength);
  console.log('blobToText result:', await blobToText(imported.blob));
}

main().catch(e => { console.error(e); process.exit(1); });
