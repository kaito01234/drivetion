/**
 * 行単位の 3-way マージ。
 * base(開いた時点 / 前回保存時点の内容)を共通の祖先として、
 * remote(Drive 上の最新)と local(この端末)の変更を合成する。
 * 同じ箇所を両方で変更していて合成できない場合は null を返す。
 */
import { diff3Merge } from 'node-diff3'

export function merge3(base: string, remote: string, local: string): string | null {
  if (local === base || remote === local) return remote
  if (remote === base) return local

  const regions = diff3Merge(local.split('\n'), base.split('\n'), remote.split('\n'), {
    excludeFalseConflicts: true,
  })
  const out: string[] = []
  for (const r of regions) {
    if (r.conflict) return null
    out.push(...r.ok)
  }
  return out.join('\n')
}
