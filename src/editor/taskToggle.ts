/**
 * チェックリスト(GFM のタスクリスト `- [ ]` / `- [x]`)のチェックボックスを、
 * タップ・クリックで ON/OFF できるようにする ProseMirror プラグイン。
 *
 * チェックボックスは CSS の疑似要素で li の左側に描いている。
 * 疑似要素へのクリックは li 自身へのクリックとして届くので、
 * 「li の左端より左」が押されたらチェックボックスへの操作とみなす。
 */
import type { Node, ResolvedPos } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * 位置を含む list_item を探す。
 * @param anyListItem true ならチェックボックスの無いリスト項目も対象にする
 */
export function findTaskItem(
  $pos: ResolvedPos,
  anyListItem = false,
): { node: Node; pos: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'list_item' && (anyListItem || node.attrs.checked != null)) {
      return { node, pos: $pos.before(d) }
    }
  }
  return null
}

function taskItemFromEvent(view: EditorView, event: MouseEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return null
  // チェックボックス(疑似要素)を押したときだけ、target が li 自身になる
  if (target.tagName !== 'LI' || target.dataset.itemType !== 'task') return null
  if (event.clientX >= target.getBoundingClientRect().left) return null
  let pos: number
  try {
    pos = view.posAtDOM(target, 0)
  } catch {
    return null
  }
  return findTaskItem(view.state.doc.resolve(pos))
}

export const taskTogglePlugin = (onToggle: () => void) =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey('task-toggle'),
        props: {
          handleDOMEvents: {
            // mousedown で処理して既定の動作(カーソル移動・選択)を止める
            mousedown(view, event) {
              const found = taskItemFromEvent(view, event)
              if (!found) return false
              event.preventDefault()
              if (!view.editable) return true
              onToggle()
              view.dispatch(
                view.state.tr.setNodeMarkup(found.pos, undefined, {
                  ...found.node.attrs,
                  checked: !found.node.attrs.checked,
                }),
              )
              return true
            },
          },
        },
      }),
  )
