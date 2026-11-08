import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const libRel = 'packages/spoint-core/src/lib.rs'
const source = readFileSync(join(spointRoot, libRel), 'utf8')
const outFile = join(here, 'fixtures', 'spoint', 'spoint-core.json')
const rustc = process.env.RUSTC || 'rustc'

const hostCode = source
  .split('\n')
  .filter((line) => line.trim() !== 'use wasm_bindgen::prelude::*;' && line.trim() !== '#[wasm_bindgen]')
  .join('\n')
  .split('#[cfg(test)]')[0]

const harness = `
fn bits(x: f64) -> String { format!("{:016x}", x.to_bits()) }
fn bits_list(v: &[f64]) -> String { v.iter().map(|x| format!("\\"{}\\"", bits(*x))).collect::<Vec<_>>().join(",") }
fn next(s: &mut u64) -> u64 { *s ^= *s << 13; *s ^= *s >> 7; *s ^= *s << 17; *s }
fn unit(s: &mut u64) -> f64 { (next(s) >> 11) as f64 / 9007199254740992.0 * 2.0 - 1.0 }
fn special(s: &mut u64) -> f64 {
    match next(s) % 14 {
        0 => 0.0,
        1 => -0.0,
        2 => f64::from_bits(0x7ff8000000000000),
        3 => f64::INFINITY,
        4 => f64::NEG_INFINITY,
        5 => 1.0,
        6 => -1.0,
        7 => 0.5,
        8 => 1e300,
        9 => -2.5,
        _ => unit(s),
    }
}
fn main() {
    let mut s: u64 = 0x9e3779b97f4a7c15;
    let mut out = String::new();
    for i in 0..2000 {
        let mut q = [0.0f64; 4];
        match i % 3 {
            0 => { for k in 0..4 { q[k] = special(&mut s); } }
            1 => {
                for k in 0..4 { q[k] = unit(&mut s); }
                let n = q.iter().map(|x| x * x).sum::<f64>().sqrt();
                if n > 0.0 { for k in 0..4 { q[k] /= n; } }
            }
            _ => { let m = [0.5, -0.5, 0.5, -0.5]; for k in 0..4 { q[k] = m[(next(&mut s) % 4) as usize]; } }
        }
        out += &format!("{{\\"op\\":\\"pack\\",\\"in\\":[{}],\\"out\\":{}}}\\n", bits_list(&q), pack_quat(q[0], q[1], q[2], q[3]));
    }
    for _ in 0..1000 {
        let p = next(&mut s) as u32;
        let v = unpack_quat(p);
        out += &format!("{{\\"op\\":\\"unpack\\",\\"in\\":{},\\"out\\":[{}]}}\\n", p, bits_list(&v));
    }
    for _ in 0..500 {
        let n = (next(&mut s) % 40) as usize;
        let bytes: Vec<u8> = (0..n).map(|_| next(&mut s) as u8).collect();
        let list = bytes.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(",");
        out += &format!("{{\\"op\\":\\"fnv1a32\\",\\"in\\":[{}],\\"out\\":{}}}\\n", list, fnv1a_32(&bytes));
    }
    for text in ["", "hello", "spoint:quest", "h\\u{e9}llo", "\\u{65e5}\\u{672c}\\u{8a9e}", "\\u{1f642} spoint", "a/b:c~d"] {
        out += &format!("{{\\"op\\":\\"fnv1aStr\\",\\"in\\":\\"{}\\",\\"out\\":{}}}\\n", text, fnv1a_str(text));
    }
    for _ in 0..1000 {
        let h = next(&mut s) as u32;
        let n = special(&mut s);
        out += &format!("{{\\"op\\":\\"fold\\",\\"in\\":[{},\\"{}\\"],\\"out\\":{}}}\\n", h, bits(n), fnv1a_fold_f64(h, n));
    }
    for _ in 0..500 {
        let a: Vec<f64> = (0..4).map(|_| special(&mut s)).collect();
        let b: Vec<f64> = (0..4).map(|_| special(&mut s)).collect();
        let r = mul_quat(a.clone(), b.clone());
        out += &format!("{{\\"op\\":\\"mulQuat\\",\\"in\\":[{}],\\"out\\":[{}]}}\\n", [bits_list(&a), bits_list(&b)].join(","), bits_list(&r));
    }
    for _ in 0..500 {
        let v: Vec<f64> = (0..3).map(|_| special(&mut s)).collect();
        let q: Vec<f64> = (0..4).map(|_| special(&mut s)).collect();
        let r = rot_vec(v.clone(), q.clone());
        out += &format!("{{\\"op\\":\\"rotVec\\",\\"in\\":[{}],\\"out\\":[{}]}}\\n", [bits_list(&v), bits_list(&q)].join(","), bits_list(&r));
    }
    print!("{}", out);
}
`

const dir = mkdtempSync(join(tmpdir(), 'spoint-core-'))
const srcFile = join(dir, 'harness.rs')
const binFile = join(dir, 'harness')
writeFileSync(srcFile, hostCode + '\n' + harness)
execFileSync(rustc, ['--edition', '2021', '-O', '-A', 'warnings', '-o', binFile, srcFile], { stdio: ['ignore', 'ignore', 'inherit'] })
const stdout = execFileSync(binFile, { maxBuffer: 256 * 1024 * 1024 }).toString()

const cases = stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))
const counts = {}
for (const c of cases) counts[c.op] = (counts[c.op] ?? 0) + 1

const fixture = {
  source: {
    file: libRel,
    sha256: createHash('sha256').update(source).digest('hex'),
    harness: 'lib.rs with the wasm_bindgen attributes and the cfg(test) module removed, compiled with rustc and run on seeded cases',
  },
  counts,
  cases,
}
writeFileSync(outFile, JSON.stringify(fixture) + '\n')
console.log('wrote spoint-core.json', JSON.stringify(counts))
