/**
 * Milkdown(WYSIWYG の Markdown エディタ)。
 * Markdown を読み込み、編集されるたびに Markdown 文字列を返す。
 *
 * 注意: Milkdown は読み込み時に書式を正規化することがある(例: `*` → `-`)。
 * 「開いただけで保存される」ことがないよう、利用者が実際に操作するまでは変更を通知しない。
 */
import {
  commandsCtx,
  defaultValueCtx,
  Editor,
  editorViewCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history, redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { indent } from '@milkdown/kit/plugin/indent'
import {
  commonmark,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
} from '@milkdown/kit/preset/commonmark'
import { gfm, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import type { CmdKey } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { callCommand, getMarkdown } from '@milkdown/kit/utils'
import { findTaskItem, taskTogglePlugin } from './taskToggle'
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react'
import { useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react'

export interface EditorHandle {
  /** 現在の内容を Markdown で取得する(利用者がまだ操作していなければ null) */
  getMarkdown(): string | null
  /** スクロール位置(作り直すときに引き継ぐため) */
  getScrollTop(): number
}

interface Props {
  defaultValue: string
  initialScrollTop?: number
  onChange: (markdown: string) => void
  handleRef?: Ref<EditorHandle>
}

export function MilkdownEditor(props: Props) {
  return (
    <MilkdownProvider>
      <EditorInner {...props} />
    </MilkdownProvider>
  )
}

function EditorInner({ defaultValue, initialScrollTop, onChange, handleRef }: Props) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const touchedRef = useRef(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const markTouched = () => {
    touchedRef.current = true
  }

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, defaultValue)
          // 箇条書きの記号は一般的な `-` で書き出す(既定は `*`)
          ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const }))
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prev) => {
            if (touchedRef.current && markdown !== prev) onChangeRef.current(markdown)
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        .use(clipboard)
        .use(indent)
        // チェックボックスのタップ・クリックで ON/OFF を切り替える
        .use(taskTogglePlugin(markTouched)),
    // defaultValue が変わったら(別ファイル・再読み込み)親側で key を変えて作り直す
    [],
  )

  const [loading, getEditor] = useInstance()

  useImperativeHandle(
    handleRef,
    () => ({
      getMarkdown: () => {
        if (!touchedRef.current || loading) return null
        try {
          return getEditor().action(getMarkdown())
        } catch {
          return null
        }
      },
      getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
    }),
    [loading, getEditor],
  )

  // 作り直した直後は、前のスクロール位置に戻す
  useEffect(() => {
    if (!loading && initialScrollTop && scrollRef.current) {
      scrollRef.current.scrollTop = initialScrollTop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // 利用者の操作(キー入力・IME・貼り付け・ドロップ)を検知する
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const mark = () => {
      touchedRef.current = true
    }
    const events = ['beforeinput', 'keydown', 'paste', 'drop', 'compositionstart', 'cut']
    events.forEach((ev) => el.addEventListener(ev, mark, true))
    return () => events.forEach((ev) => el.removeEventListener(ev, mark, true))
  }, [])

  function run<T>(cmd: { key: CmdKey<T> }, payload?: T) {
    if (loading) return
    touchedRef.current = true
    getEditor().action(callCommand(cmd.key, payload))
  }

  function act(fn: (ctx: Ctx) => void) {
    if (loading) return
    touchedRef.current = true
    getEditor().action(fn)
  }

  return (
    <div className="milkdown-wrapper" ref={wrapperRef}>
      <div className="toolbar" role="toolbar" onMouseDown={(e) => e.preventDefault()}>
        <ToolButton label="見出し1" onClick={() => run(wrapInHeadingCommand, 1)}>H1</ToolButton>
        <ToolButton label="見出し2" onClick={() => run(wrapInHeadingCommand, 2)}>H2</ToolButton>
        <ToolButton label="見出し3" onClick={() => run(wrapInHeadingCommand, 3)}>H3</ToolButton>
        <ToolButton label="太字" onClick={() => run(toggleStrongCommand)}><b>B</b></ToolButton>
        <ToolButton label="斜体" onClick={() => run(toggleEmphasisCommand)}><i>I</i></ToolButton>
        <ToolButton label="取り消し線" onClick={() => run(toggleStrikethroughCommand)}><s>S</s></ToolButton>
        <ToolButton label="コード" onClick={() => run(toggleInlineCodeCommand)}>{'</>'}</ToolButton>
        <ToolButton label="箇条書き" onClick={() => run(wrapInBulletListCommand)}>•</ToolButton>
        <ToolButton label="番号付きリスト" onClick={() => run(wrapInOrderedListCommand)}>1.</ToolButton>
        <ToolButton label="チェックリスト" onClick={() => act(toggleTaskList)}>☑</ToolButton>
        <ToolButton label="引用" onClick={() => run(wrapInBlockquoteCommand)}>❝</ToolButton>
        <ToolButton label="コードブロック" onClick={() => run(createCodeBlockCommand)}>{'{ }'}</ToolButton>
        <ToolButton label="元に戻す" onClick={() => run(undoCommand)}>↶</ToolButton>
        <ToolButton label="やり直す" onClick={() => run(redoCommand)}>↷</ToolButton>
      </div>
      <div className="editor-scroll" ref={scrollRef}>
        <Milkdown />
      </div>
    </div>
  )
}

function ToolButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="tool-btn" title={props.label} aria-label={props.label} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

/**
 * カーソル位置の行をチェックリストにする / 戻す。
 * リストの中ならその項目のチェックボックスを付け外しし、リストの外なら箇条書きにしてからチェックボックスを付ける。
 */
function toggleTaskList(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  const found = findTaskItem(view.state.selection.$from, true)
  if (found) {
    const { node, pos } = found
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        checked: node.attrs.checked == null ? false : null,
      }),
    )
    view.focus()
    return
  }
  ctx.get(commandsCtx).call(wrapInBulletListCommand.key)
  const created = findTaskItem(view.state.selection.$from, true)
  if (created) {
    view.dispatch(
      view.state.tr.setNodeMarkup(created.pos, undefined, { ...created.node.attrs, checked: false }),
    )
  }
  view.focus()
}
