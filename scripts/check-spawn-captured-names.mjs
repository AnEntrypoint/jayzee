import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { decodeName, encodeName } from '../src/spawn/cdnName.js'
import { ledgerBucket, ledgerKey, parseLedgerKey } from '../src/spawn/ledger.js'

const CAPTURED_KEYS = [
  'world.assets/43/~2fcdn~2fvalue.bdb2ebab62424ec13d0989e5a711c12b0ecd0765d31e2bdbd2339da4c6959fd6.png.yaml',
  'world.assets/fe/~2fcdn~2fvalue.1af5ee047d750da2bf79364dd026c0962fe510ef48e1b5f605db3fe6020f0a84.jpg.yaml',
  'world.assets/20/~2fcdn~2fvalue.e29225f6d5479a4779f0d17618633b90d94fbd9c7baa566f74d4eee33d036402.glb.yaml',
  'world.assets/05/~2fcdn~2fvalue.65876aa9c2c2584ba4d7a3d697503971271a7ad1772068e24bb6581a26332c3a.glb.yaml',
  'world.assets/00/~2fcdn~2fvalue.d64293bc5545606781614c78d4b923a11974da21b854a005a6c3b6fc2ee88cc6.png.yaml',
  'world.assets/00/~2fcdn~2fvalue.39708916f2190e8272ff79445d118eb9a5781caccdb43a79317fc495ea71552d.mp3.yaml',
  'world.assets/0c/~2fcdn~2fvalue.3b9590b7fe4ae3617bf35c8677f0068b9bdb3d7e4bfc6bc9edbec62f5912175d.png.yaml',
  'world.assets/04/~2fcdn~2fvalue.3015d3bed5114f04c7d6b9d451ce185c80afdfe910fd34741b7c38aa339d1d74.mp3.yaml',
  'world.assets/00/~2fcdn~2fvalue.9ef1b0e2a272d0e08946b6b7284035c9b66715dbfa7e6aeeaa45ccfef1c759ca.glb.yaml',
  'world.assets/04/~2fcdn~2fvalue.6f4fa8a2e549d9f9b17c18386f407c80b3b53bcc000689e69428e50ea060dee7.glb.yaml',
  'world.assets/5f/~2fcdn~2fvalue.258c9e6e532a87be37c51194e3efca8d224f0a4ff69309118e9337a9ec957d83.glb.yaml',
  'world.assets/36/~2fcdn~2fvalue.640c474063532d127fe7c5265c133bbdea24d230ad4fae3e21694d6c447820d9.glb.yaml',
  'world.assets/00/~2fcdn~2fvalue.08068b1929fcf2f9cb3aa6f47b9ae650d3cf02d373c8e97fb4ad8420a88987a2.glb.yaml',
  'world.assets/01/~2fcdn~2fvalue.add2ee27762faac9260d482da43f115ebd2f6b60e8c5688e7671bb7d6a9acbcf.jpeg.yaml',
  'world.assets/d6/~2fcdn~2fvalue.c3c289dca2f99415b555e977d4dd1fe1d002457b71489f4b59305861c0aa5208.glb.yaml',
  'world.assets/12/~2fcdn~2fvalue.4e778f06ed5a850b3e2b0a169bae8d87e4dba7368a7ea7208c6d8b4886c125de.glb.yaml',
  'world.assets/b7/~2fcdn~2fvalue.ad8b30dfa4dba7aa58b0df1f195c21ee5527f8e2a11993630ba3fa743e9318e3.jpeg.yaml',
  'world.assets/74/~2fcdn~2fvalue.f341d8b64ae32d283dfb19840bdcddd1fd1e070a9bc71997bcd8c0a86dec6875.jpeg.yaml',
  'world.assets/10/~2fcdn~2fvalue.a57bcb92f30600b865e02560213730849dc921ca042c3c5bfd388a65d51ce9fb.glb.yaml',
  'world.assets/99/~2fcdn~2fvalue.d2a3e230b85f24be3a76945967237717651d0e9ed266e16d48194a6ed3edc888.glb.yaml',
  'world.assets/95/~2fcdn~2fvalue.78e03fc5455b7772ecd4fd4155fdad048cd8fb5af2892da18c48dbcd88f0caae.glb.yaml',
  'world.assets/12/~2fcdn~2fvalue.a65de720d79e507df219f4127e850e8d02fbf233bf7527213cd41206ddec3c5b.jpeg.yaml',
  'world.assets/c8/~2fcdn~2fvalue.bebaf5d776a565aef69cc8c2acd807f63260631bcd1b96a52b97bb309ecb2c0a.glb.yaml',
  'world.assets/bf/~2fcdn~2fvalue.b219887f2cc0c1af42c52d1e2f951e3b57d1392d30f2f9542fbd39f6652fe3c8.glb.yaml',
  'world.assets/b2/~2fcdn~2fvalue.ee04ed0dad0e7bbfd5cd9576c841cdf2ca7b19f02c3e7329551ed6f641c29742.glb.yaml',
  'world.assets/39/~2fcdn~2fvalue.74997e3b0e3220e313a25fc2476749087adcc3d75daa64a2e272384df9367958.jpeg.yaml',
  'world.assets/59/~2fcdn~2fvalue.0ae946594ec9e2ef5a7f1b3879c8ee194d40896f58ba240a31b3f6aa2946cfb4.glb.yaml',
  'world.assets/b0/~2fcdn~2fvalue.016343c7a8f3e6ccf42c607c18dc397d3194ee29a12f756013bcb3fe6a81a3c9.mp4.yaml',
  'world.assets/8f/~2fcdn~2fneutral-default-avatar.glb.yaml',
  'world.assets/0c/~2fcdn~2fvalue.3e56c3a73bcc685ac673ad7014685acb1cf3f832fdfb89e255621d9909ae82e2.glb.yaml',
  'world.assets/86/~2fcdn~2fvalue.cfa4c7b7d8e07f56ebc8d53625ff1abdf35fcbab2b0bbc87eee085b0db7d9ea5.png.yaml',
  'world.assets/48/~2fcdn~2fvalue.15c91bed9679074888fb01aadfdca0ea615a704e49e0745c6971a01ab38ed148.mp4.yaml',
  'world.assets/01/~2fcdn~2fvalue.e7e242feaae83f9a6b084f6e6e6fabe70e89adc356ebdd24dd219ec9fcad762a.png.yaml',
  'world.assets/ab/~2fcdn~2fvalue.6500179e06098e84a304950cda78a96d1d17f1d3b06c15bfafdfc143d1ce89f2.png.yaml',
  'world.assets/37/~2fcdn~2fvalue.c30d50b4a21159f2a47553cc80547a5f7041692816494672a1cd6d5601dcef9a.glb.yaml',
  'world.assets/25/~2fcdn~2fvalue.c84cb3da157cf318888e0ad887dda628ce8e9e72881f8c0e6156f1dcada61e84.jpg.yaml',
  'world.assets/00/~2fcdn~2fvalue.e2e0add5dd838468fc59d0559b9554b9abf7e1bcbcdef7419b5348134ee00239.jpeg.yaml',
]

const segmentOf = (key) => key.slice('world.assets/xx/'.length, -'.yaml'.length)
const parsed = CAPTURED_KEYS.map((key) => {
  const bucket = key.slice('world.assets/'.length, 'world.assets/xx'.length)
  const asset = decodeName(segmentOf(key))
  return { key, bucket, asset }
})

gate('the census holds 37 captured ledger keys, each with a two-hex bucket', () => {
  assert.equal(CAPTURED_KEYS.length, 37)
  for (const { key, bucket } of parsed) assert.match(bucket, /^[0-9a-f]{2}$/, key)
})

gate('the bucket rule (top byte of FNV-1a over the UTF-16 code units) gives the captured bucket of every key', () => {
  for (const { key, bucket, asset } of parsed) assert.equal(ledgerBucket(asset), bucket, key)
})

gate('ledgerKey rebuilds every captured key exactly from its decoded asset name', () => {
  for (const { key, asset } of parsed) assert.equal(ledgerKey(asset), key, asset)
})

gate('parseLedgerKey reads every captured key back to the same bucket and asset name', () => {
  for (const { key, bucket, asset } of parsed) {
    assert.deepEqual(parseLedgerKey(key), { bucket, asset }, key)
  }
})

gate('encodeName reproduces the encoded segment of every captured key from its decoded name', () => {
  for (const { key, asset } of parsed) assert.equal(encodeName(asset), segmentOf(key), key)
})

gate('the captured keys escape only the slash (~2f), and every escape decodes back to the same bytes', () => {
  const escapes = new Set()
  for (const { key } of parsed) for (const hex of segmentOf(key).match(/~[0-9a-f]{2}/g) ?? []) escapes.add(hex)
  assert.deepEqual([...escapes], ['~2f'])
  for (const { key, asset } of parsed) assert.equal(decodeName(segmentOf(key)), asset, key)
})

gate('the names decode to the cdn paths the census names (a value file or a neutral default avatar)', () => {
  const values = parsed.filter(({ asset }) => /^\/cdn\/value\.[0-9a-f]{64}\.[a-z0-9]+$/.test(asset))
  assert.equal(values.length, 36)
  assert.equal(parsed.filter(({ asset }) => asset === '/cdn/neutral-default-avatar.glb').length, 1)
})

gate('the captured keys hold no raw colon, raw tilde or non-ASCII byte in their encoded segment', () => {
  for (const { key } of parsed) {
    const segment = segmentOf(key)
    assert.ok(!segment.includes(':'), key)
    assert.ok(!/~(?![0-9a-f]{2})/.test(segment), key)
    assert.ok(/^[\x00-\x7f]*$/.test(segment), key)
  }
})

gate('encoder rule for a colon, a tilde, capitals and a non-ASCII byte (no captured key witnesses these; they follow the rule the upstream checkout probe test writes)', () => {
  assert.equal(encodeName('a:b'), 'a~3ab')
  assert.equal(encodeName('a~b'), 'a~7eb')
  assert.equal(encodeName('Ab'), '~41b')
  assert.equal(encodeName('é'), '~c3~a9')
})

finish()
