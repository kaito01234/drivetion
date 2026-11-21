/**
 * Milkdown(WYSIWYG の Markdown エディタ)。
 * Markdown を読み込み、編集されるたびに Markdown 文字列を返す。
 *
 * 注意: Milkdown は読み込み時に書式を正規化することがある(例: `*` → `-`)。
 * 「開いただけで保存される」ことがないよう、利用者が実際に操作するまでは変更を通知しない。
 */
import { defaultValueCtx, Editor, rootCtx } from '@milkdown/kit/core'
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
import { callCommand, getMarkdown } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react'
import { useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react'

export interface EditorHandle {
  /** 現在の内容を Markdown で取得する(利用者がまだ操作していなければ null) */
  getMarkdown(): string | null
}

interface Props {
  defaultValue: string
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

function EditorInner({ defaultValue, onChange, handleRef }: Props) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const touchedRef = useRef(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, defaultValue)
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prev) => {
            if (touchedRef.current && markdown !== prev) onChangeRef.current(markdown)
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        .use(clipboard)
        .use(indent),
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
    }),
    [loading, getEditor],
  )

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
        <ToolButton label="引用" onClick={() => run(wrapInBlockquoteCommand)}>❝</ToolButton>
        <ToolButton label="コードブロック" onClick={() => run(createCodeBlockCommand)}>{'{ }'}</ToolButton>
        <ToolButton label="元に戻す" onClick={() => run(undoCommand)}>↶</ToolButton>
        <ToolButton label="やり直す" onClick={() => run(redoCommand)}>↷</ToolButton>
      </div>
      <div className="editor-scroll">
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
